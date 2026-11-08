import type { Server } from "node:http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { ClienteFrame, ServidorFrame, BuscarProdutos, Produto } from "../gen/produtos/v1/busca";
import { checkPeriod, parseListFilters } from "../utils/helpers/list_filters";
import { PRODUTO_FILTERS, ProdutoFilters } from "../utils/schemas/list_filters.schema";
import { isAdminRole } from "../utils/helpers/permissoes.util";
import toHttpStatus from "../utils/helpers/http_status.util";
import serializeError from "../utils/logger/serialize_error.util";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import type { SessionResult } from "../middlewares/auth.middleware";
import type { BaseAppError } from "../errors/global_error.error";
import type { Either } from "../globals/errors/left_right_either.error";
import type { ProductResponseDto } from "../dtos/product_dtos/product_response.dto";
import type { ResponseScrollProductsDto } from "../dtos/product_dtos/get_products.dto";

// The product list over a WebSocket (proto/produtos/v1/busca.proto): one connection per tab, binary
// protobuf frames, on the API's own HTTP server, so there is no second port or process. Every request
// goes through what GET /products/scroll goes through: the session checks of AuthMiddleware (the usuario
// is reloaded each time, so a deactivation or a password change applies at once), the same filter
// validation, and the same ProductService call (with its per-session first-page cache).

export const SOCKET_PATH = "/ws";
// a frame is a search, a few hundred bytes; anything near this is not one
const MAX_FRAME_BYTES = 64 * 1024;
// the client authenticates right after it connects
const AUTH_TIMEOUT_MS = 10_000;
// dead connections (a laptop lid closed) are found by ping and dropped
const HEARTBEAT_MS = 30_000;
// a tab sends one search per keystroke at most; a burst past this is closed, like REST's 429
const MAX_IN_FLIGHT = 8;

export type ProductSocketDeps = {
  resolveSession: (token: string) => Promise<SessionResult>;
  getProductsScroll: (
    sessao: string,
    cursor: string | undefined,
    amount: number,
    includeInactive: boolean,
    filters: ProdutoFilters,
  ) => Promise<Either<BaseAppError, ResponseScrollProductsDto>>;
  logger: LoggerInterface;
  // the CORS allowlist: a page from any other origin can't open the socket either
  isAllowedOrigin: (origin: string | undefined) => boolean;
};

const send = (ws: WebSocket, frame: ServidorFrame) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(ServidorFrame.encode(frame).finish());
};

const erro = (id: number, status: number, mensagem: string): ServidorFrame => ({ erro: { id, status, mensagem } });

const toProduto = (p: ProductResponseDto): Produto => ({
  id: p.id,
  name: p.name,
  ativo: p.ativo,
  sku: p.sku,
  categoria: { id: p.categoria?.id ?? "", nome: p.categoria?.nome ?? "", tipo: p.categoria?.tipo ?? "" },
  valorDeCusto: Number(p.valor_de_custo),
  icms: Number(p.icms),
  valorDeVenda: Number(p.valor_de_venda),
  // what JSON.stringify makes of the Date on REST
  dataDeCadastro: new Date(p.data_de_cadastro).toISOString(),
  quantidadeEmEstoque: Number(p.quantidade_em_estoque),
});

// the REST query string's shape, so parseListFilters validates both transports the same way
const toQuery = (f: BuscarProdutos["filtros"]) => {
  const query: Record<string, string | string[]> = {};
  if (!f) return query;
  if (f.categoria.length) query.categoria = f.categoria;
  if (f.icms.length) query.icms = f.icms;
  if (f.status.length) query.status = f.status;
  if (f.busca) query.busca = f.busca;
  if (f.buscaPor) query.busca_por = f.buscaPor;
  if (f.cadastroDesde) query.cadastro_desde = f.cadastroDesde;
  if (f.cadastroAntes) query.cadastro_antes = f.cadastroAntes;
  return query;
};

/** Serves one connection. Exported for tests, which drive it without an HTTP server. */
export function handleConnection(ws: WebSocket, deps: ProductSocketDeps) {
  const { logger } = deps;
  let token: string | null = null;
  let inFlight = 0;

  const authTimer = setTimeout(() => {
    if (!token) ws.close(4401, "authentication timeout");
  }, AUTH_TIMEOUT_MS);
  ws.once("close", () => clearTimeout(authTimer));

  const fail = (id: number, status: number, message: string, error?: unknown) => {
    logger.handle(
      { layer: "socket", socket: "produtos", requestId: id, statusCode: status, ...(error ? { error: serializeError(error) } : {}) },
      status >= 500 ? ErrorLevelsEnum.Values.ERROR : ErrorLevelsEnum.Values.WARN,
      message,
    );
    // 5xx details stay in the log, as on REST
    send(ws, erro(id, status, status >= 500 ? "internal server error" : message));
  };

  const buscar = async (req: BuscarProdutos) => {
    const session = await deps.resolveSession(token ?? "");
    if (!session.ok) {
      if (session.error) return fail(req.id, 500, session.message, session.error);
      fail(req.id, 401, session.message);
      return ws.close(4401, "session ended");
    }
    if (session.usuario.trocaSenhaObrigatoria) return fail(req.id, 403, "Troque sua senha antes de continuar.");

    const filters = parseListFilters(toQuery(req.filtros), PRODUTO_FILTERS);
    if (filters.isLeft()) return fail(req.id, 400, filters.value.message);
    const periodo = checkPeriod(filters.value.cadastro_desde, filters.value.cadastro_antes, "cadastro");
    if (periodo) return fail(req.id, 400, periodo.message);

    const result = await deps.getProductsScroll(
      `${session.usuario.id}:${session.sessaoVersao}`,
      req.cursor || undefined,
      req.quantidade || 30,
      // ADM/SU also see deactivated products, as on REST
      isAdminRole(session.usuario.permissoes),
      filters.value,
    );
    if (result.isLeft()) {
      const status = toHttpStatus(result.value.statusCode);
      return fail(req.id, status, result.value.message, status >= 500 ? result.value : undefined);
    }
    const page = result.value;
    send(ws, { pagina: { id: req.id, produtos: page.data.map(toProduto), pageSize: page.pageSize, nextCursor: page.nextCursor ?? "" } });
  };

  ws.on("message", (data: RawData, isBinary: boolean) => {
    let frame: ClienteFrame;
    try {
      if (!isBinary) throw new Error("text frame");
      frame = ClienteFrame.decode(Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]));
    } catch {
      fail(0, 400, "Frame inválido");
      return ws.close(1003, "invalid frame");
    }

    if (frame.autenticar) {
      void deps.resolveSession(frame.autenticar.token).then(
        (session) => {
          if (!session.ok) {
            if (session.error) return fail(0, 500, session.message, session.error);
            fail(0, 401, session.message);
            return ws.close(4401, "unauthenticated");
          }
          token = frame.autenticar!.token;
          send(ws, { autenticado: {} });
        },
        (err) => fail(0, 500, "internal server error", err),
      );
      return;
    }

    if (frame.buscar) {
      const req = frame.buscar;
      if (!token) return fail(req.id, 401, "Token de autenticação ausente");
      if (inFlight >= MAX_IN_FLIGHT) {
        fail(req.id, 429, "Muitas requisições ao mesmo tempo");
        return ws.close(1008, "too many requests");
      }
      inFlight++;
      buscar(req)
        .catch((err) => fail(req.id, 500, "internal server error", err))
        .finally(() => inFlight--);
      return;
    }
    fail(0, 400, "Frame vazio");
  });
}

/**
 * Adds the product socket to the API's HTTP server, at SOCKET_PATH. Returns a close function for shutdown.
 */
export function attachProductSocket(server: Server, deps: ProductSocketDeps) {
  const wss = new WebSocketServer({
    server,
    path: SOCKET_PATH,
    maxPayload: MAX_FRAME_BYTES,
    verifyClient: ({ origin }: { origin?: string }) => deps.isAllowedOrigin(origin),
  });
  const alive = new WeakSet<WebSocket>();

  wss.on("connection", (ws, req) => {
    // verifyClient refuses the handshake on Node; Bun's ws ignores it, so the origin is checked here too
    if (!deps.isAllowedOrigin(req.headers.origin)) {
      ws.close(4403, "origin not allowed");
      return;
    }
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
    ws.on("error", (err) => deps.logger.handle({ layer: "socket", socket: "produtos", error: serializeError(err) }, ErrorLevelsEnum.Values.WARN, "socket error"));
    handleConnection(ws, deps);
  });
  wss.on("error", (err) => deps.logger.handle({ layer: "socket", socket: "produtos", error: serializeError(err) }, ErrorLevelsEnum.Values.ERROR, "socket server error"));

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return () =>
    new Promise<void>((resolve) => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, "server shutting down");
      wss.close(() => resolve());
    });
}
