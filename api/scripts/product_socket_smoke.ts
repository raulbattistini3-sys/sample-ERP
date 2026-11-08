// Smoke test of the product socket (src/sockets/produtos.socket.ts) over a real HTTP server and a real
// WebSocket client, with fake auth and a fake ProductService: no database, nothing else started.
//   bun scripts/product_socket_smoke.ts        (Bun, as in the launcher build)
//   npx tsx scripts/product_socket_smoke.ts   (Node)
// Exits 1 when any check fails.
import http from "node:http";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { attachProductSocket, SOCKET_PATH } from "../src/sockets/produtos.socket";
import { ClienteFrame, ServidorFrame } from "../src/gen/produtos/v1/busca";
import { right, left } from "../src/globals/errors/left_right_either.error";
import { ValidationError } from "../src/errors/client_errors/four_xx.error";
import type { ProductSocketDeps } from "../src/sockets/produtos.socket";
import type { SessionResult } from "../src/middlewares/auth.middleware";

const usuario = { id: "u1", nome: "Ana", email: "a@x", permissoes: "USR", ativo: true, trocaSenhaObrigatoria: false } as never;
let sessionOk = true;
const calls: unknown[][] = [];
const logs: string[] = [];

const deps: ProductSocketDeps = {
  resolveSession: async (token): Promise<SessionResult> =>
    token === "good" && sessionOk ? { ok: true, usuario, sessaoVersao: 3 } : { ok: false, message: "Token inválido ou expirado" },
  getProductsScroll: async (...args) => {
    calls.push(args);
    if (args[1] === "bad-cursor") return left(new ValidationError("400", "Cursor inválido"));
    return right({
      data: [
        {
          id: "p1", name: "Cadeira", ativo: true, sku: "LT-0000001",
          categoria: { id: "c1", nome: "ELETRONICOS", tipo: "x" } as never,
          valor_de_custo: 10, icms: 18, valor_de_venda: 20,
          data_de_cadastro: new Date("2026-01-02T03:04:05.000Z"), quantidade_em_estoque: 5,
        },
      ],
      pageSize: 30,
      nextCursor: "next-1",
    });
  },
  logger: { handle: (_o: unknown, _l: unknown, m?: string) => void logs.push(String(m)) } as never,
  isAllowedOrigin: (origin) => !origin || origin === "http://localhost:5173",
};

let url = "";

function open(origin = "http://localhost:5173") {
  // Bun's ws client ignores `origin`, so the header is set directly too (a browser always sends it)
  const ws = new WebSocket(url, { origin, headers: { Origin: origin } });
  const inbox: ServidorFrame[] = [];
  const waiters: ((f: ServidorFrame) => void)[] = [];
  ws.on("message", (data: Buffer) => {
    const f = ServidorFrame.decode(new Uint8Array(data));
    const w = waiters.shift();
    if (w) w(f);
    else inbox.push(f);
  });
  const next = () => new Promise<ServidorFrame>((resolve, reject) => {
    const f = inbox.shift();
    if (f) return resolve(f);
    const t = setTimeout(() => reject(new Error("no frame within 2s")), 2000);
    waiters.push((x) => (clearTimeout(t), resolve(x)));
  });
  const sendFrame = (f: ClienteFrame) => ws.send(ClienteFrame.encode(f).finish());
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  return { ws, next, sendFrame, closed, opened };
}

const checks: [string, () => Promise<void>][] = [
  ["authenticates, then a search returns the page", async () => {
    const c = open();
    await c.opened;
    c.sendFrame({ autenticar: { token: "good" } });
    assert.deepEqual((await c.next()).autenticado, {});
    c.sendFrame({ buscar: { id: 7, cursor: "", quantidade: 0, filtros: { categoria: ["ELETRONICOS"], icms: [], status: [], busca: "lt-00", buscaPor: "sku", cadastroDesde: "", cadastroAntes: "" } } });
    const f = await c.next();
    assert.equal(f.pagina?.id, 7);
    assert.equal(f.pagina?.nextCursor, "next-1");
    assert.equal(f.pagina?.produtos[0].sku, "LT-0000001");
    assert.equal(f.pagina?.produtos[0].dataDeCadastro, "2026-01-02T03:04:05.000Z");
    assert.equal(f.pagina?.produtos[0].categoria?.nome, "ELETRONICOS");
    // what REST would pass: session key, no cursor, 30 rows, not admin, the parsed filters
    assert.deepEqual(calls.at(-1), ["u1:3", undefined, 30, false, { categoria: ["ELETRONICOS"], busca: ["lt-00"], busca_por: ["sku"] }]);
    c.ws.close();
  }],
  ["invalid filters answer 400 with REST's message", async () => {
    const c = open();
    await c.opened;
    c.sendFrame({ autenticar: { token: "good" } });
    await c.next();
    c.sendFrame({ buscar: { id: 8, cursor: "", quantidade: 30, filtros: { categoria: ["Nope"], icms: [], status: [], busca: "", buscaPor: "", cadastroDesde: "", cadastroAntes: "" } } });
    const f = await c.next();
    assert.equal(f.erro?.id, 8);
    assert.equal(f.erro?.status, 400);
    assert.match(f.erro?.mensagem ?? "", /Valor inválido em categoria/);
    c.sendFrame({ buscar: { id: 9, cursor: "bad-cursor", quantidade: 30, filtros: undefined } });
    assert.deepEqual((await c.next()).erro, { id: 9, status: 400, mensagem: "Cursor inválido" });
    c.ws.close();
  }],
  ["a bad token is refused and the socket closed", async () => {
    const c = open();
    await c.opened;
    c.sendFrame({ autenticar: { token: "bad" } });
    assert.equal((await c.next()).erro?.status, 401);
    assert.equal(await c.closed, 4401);
  }],
  ["a search before authenticating is a 401", async () => {
    const c = open();
    await c.opened;
    c.sendFrame({ buscar: { id: 3, cursor: "", quantidade: 30, filtros: undefined } });
    assert.deepEqual((await c.next()).erro, { id: 3, status: 401, mensagem: "Token de autenticação ausente" });
    c.ws.close();
  }],
  ["a session that ends mid-connection is refused on the next search", async () => {
    const c = open();
    await c.opened;
    c.sendFrame({ autenticar: { token: "good" } });
    await c.next();
    sessionOk = false;
    c.sendFrame({ buscar: { id: 4, cursor: "", quantidade: 30, filtros: undefined } });
    assert.equal((await c.next()).erro?.status, 401);
    assert.equal(await c.closed, 4401);
    sessionOk = true;
  }],
  ["a text frame is refused", async () => {
    const c = open();
    await c.opened;
    c.ws.send("hello");
    assert.equal((await c.next()).erro?.status, 400);
    assert.equal(await c.closed, 1003);
  }],
  ["a page from another origin can't connect or search", async () => {
    const c = open("https://evil.example");
    // Node refuses the handshake; Bun accepts it and the server closes at once with 4403
    const outcome = await c.opened.then(() => c.closed, () => "refused");
    assert.ok(outcome === "refused" || outcome === 4403, `got ${outcome}`);
  }],
];

async function main() {
const server = http.createServer();
const close = attachProductSocket(server, deps);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address() as { port: number };
url = `ws://127.0.0.1:${port}${SOCKET_PATH}`;
let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${(err as Error).message}`);
  }
}
await close();
server.close();
console.log(failed ? `${failed} failed` : `all ${checks.length} passed (${!("Bun" in globalThis) ? "node" : "bun"})`);
process.exit(failed ? 1 : 0);
}
void main();
