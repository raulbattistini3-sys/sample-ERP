import { ClienteFrame, ServidorFrame, type Filtros, type ProdutosPagina } from "../gen/produtos/v1/busca";
import { clearSession, getToken } from "./auth-storage";

// The product list over a WebSocket (proto/produtos/v1/busca.proto): one connection for the tab, opened on
// the first request, binary protobuf frames, replies matched to requests by id. The API serves it on its
// own port at /ws (api/src/sockets/produtos.socket.ts).
//
// It never stands between the user and the list: when the socket can't be opened (the launcher's gateway
// doesn't forward sockets yet, a proxy, an old API) the request throws SocketUnavailable and the caller
// uses REST, and the socket isn't tried again for a while.

/** The socket couldn't be used for this request; the caller falls back to REST. */
export class SocketUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocketUnavailable";
  }
}

/** The API answered the request with an error, as REST would with this status. */
export class SocketRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SocketRequestError";
  }
}

const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
// after a failed connection, REST only for this long
const RETRY_AFTER_MS = 30_000;

// ws(s)://<API>/ws: VITE_API_URL is a full address (vite dev server, Docker) or a path (the gateway's /api)
function socketUrl(): string {
  const base = new URL(import.meta.env.VITE_API_URL ?? "", window.location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/ws`;
  return base.toString();
}

/** A page, with what the request cost on the wire. */
export type SocketReply = {
  pagina: ProdutosPagina;
  /** ms to open and authenticate the connection this request had to wait for; 0 when it reused one */
  connectMs: number;
  /** bytes of the reply frame */
  bytes: number;
};

type Pending = { resolve: (r: { pagina: ProdutosPagina; bytes: number }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

// the 401 handling of lib/api-client.ts
function sessionEnded() {
  clearSession();
  window.location.href = "/login?sessao=encerrada";
}

class ProductSocket {
  #ws: WebSocket | null = null;
  #ready: Promise<WebSocket> | null = null;
  #token: string | null = null;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #unavailableUntil = 0;

  /** One page of the product list. Throws SocketUnavailable (use REST) or SocketRequestError (the API's answer). */
  async buscar(cursor: string | undefined, quantidade: number, filtros: Filtros): Promise<SocketReply> {
    const t0 = performance.now();
    const reused = this.#ready !== null && this.#token === getToken();
    const ws = await this.#connect();
    const connectMs = reused ? 0 : performance.now() - t0;
    const id = this.#nextId++;
    const reply = await new Promise<{ pagina: ProdutosPagina; bytes: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new SocketUnavailable("no reply in time"));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      ws.send(ClienteFrame.encode({ buscar: { id, cursor: cursor ?? "", quantidade, filtros } }).finish());
    });
    return { ...reply, connectMs };
  }

  close() {
    this.#ws?.close(1000, "closed by the page");
    this.#reset(new SocketUnavailable("socket closed"));
  }

  #connect(): Promise<WebSocket> {
    const token = getToken();
    if (!token) return Promise.reject(new SocketUnavailable("signed out"));
    // signed in as someone else since: a fresh connection
    if (this.#token !== token && this.#ws) this.close();
    if (this.#ready) return this.#ready;
    if (Date.now() < this.#unavailableUntil) return Promise.reject(new SocketUnavailable("socket recently unavailable"));
    if (typeof WebSocket === "undefined") return Promise.reject(new SocketUnavailable("no WebSocket in this browser"));

    this.#token = token;
    this.#ready = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const giveUp = (reason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#unavailableUntil = Date.now() + RETRY_AFTER_MS;
        this.#reset(new SocketUnavailable(reason));
        try {
          ws.close();
        } catch {
          // already closed
        }
        reject(new SocketUnavailable(reason));
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(socketUrl());
      } catch (err) {
        this.#ready = null;
        this.#unavailableUntil = Date.now() + RETRY_AFTER_MS;
        reject(new SocketUnavailable(String(err)));
        return;
      }
      ws.binaryType = "arraybuffer";
      this.#ws = ws;
      const timer = setTimeout(() => giveUp("connection timeout"), CONNECT_TIMEOUT_MS);

      ws.onopen = () => ws.send(ClienteFrame.encode({ autenticar: { token } }).finish());
      ws.onerror = () => giveUp("connection failed");
      ws.onclose = (e) => {
        if (!settled) return giveUp(`closed while connecting (${e.code})`);
        // 4401: the session ended (deactivated, password changed, token expired), as a REST 401
        if (e.code === 4401) sessionEnded();
        this.#reset(new SocketUnavailable(`socket closed (${e.code})`));
      };
      ws.onmessage = (e) => {
        if (!(e.data instanceof ArrayBuffer)) return;
        let frame: ServidorFrame;
        try {
          frame = ServidorFrame.decode(new Uint8Array(e.data));
        } catch {
          return;
        }
        if (frame.autenticado) {
          settled = true;
          clearTimeout(timer);
          resolve(ws);
          return;
        }
        if (frame.pagina) {
          const bytes = e.data.byteLength;
          this.#settle(frame.pagina.id, (p) => p.resolve({ pagina: frame.pagina!, bytes }));
          return;
        }
        if (frame.erro) {
          const { id, status, mensagem } = frame.erro;
          if (status === 401 && !settled) {
            // the token was refused at the handshake: the session is over, as a REST 401
            settled = true;
            clearTimeout(timer);
            this.#reset(new SocketRequestError(401, mensagem));
            reject(new SocketRequestError(401, mensagem));
            sessionEnded();
            return;
          }
          // a 401 on a request is followed by a 4401 close, which ends the session (onclose)
          if (id === 0) return;
          this.#settle(id, (p) => p.reject(new SocketRequestError(status, mensagem)));
        }
      };
    });
    return this.#ready;
  }

  #settle(id: number, fn: (p: Pending) => void) {
    const p = this.#pending.get(id);
    if (!p) return;
    this.#pending.delete(id);
    clearTimeout(p.timer);
    fn(p);
  }

  #reset(reason: Error) {
    this.#ws = null;
    this.#ready = null;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.#pending.clear();
  }
}

export const productSocket = new ProductSocket();
