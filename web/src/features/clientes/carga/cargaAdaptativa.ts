import axios, { type AxiosRequestConfig } from "axios";
import { apiClient } from "../../../lib/api-client";
import { telemetry } from "../../../lib/telemetry";

// Loading a Clientes/Empresas page: the body arrives as bytes and is decoded + parsed either on the main
// thread or in a worker (carga.worker.ts), chosen per page with the same adaptive rule as the product
// search scheduler (pkg/tablecore/scheduler.js):
//
//   budget = B · pressureFactor · (1 − min(0.8, mainBusy))
//   main    if predicted main-thread parse ≤ budget
//   worker  otherwise, when receiving the parsed object (the only main-thread cost of the worker path:
//           the bytes are transferred, not copied) is predicted cheaper than parsing it here
//   with probability ε the other side is tried, so both predictions keep learning; main is only explored
//   when its prediction is ≤ 2·budget, so exploring never causes a long task
//
// B is one frame (16 ms), not the 50 ms long-task threshold: the page still has to render the rows after
// the parse. mainBusy and the pressure come from lib/telemetry's signals (long animation frames, Compute
// Pressure), so a busy or throttled device moves big pages to the worker sooner.
//
// Each load emits one telemetry event (source "search", type "request": the same event as before, with
// the decision added) with the decision, its inputs and the measured costs: bytes and milliseconds only,
// never the rows nor what was searched (only whether there was a search, and its length).

export type Alvo = "main" | "worker";
type Estrategia = "adaptive" | Alvo;

const ORCAMENTO_MS = 16;
const EPSILON = 0.05;
const FATOR_PRESSAO: Record<string, number> = { nominal: 1, fair: 1, serious: 0.75, critical: 0.5 };

// ms per KB of body, an exponential moving average per side. Starting guesses: JSON.parse runs at
// ~250 MB/s on a mid laptop; receiving a structured clone is a bit cheaper.
const ALFA = 0.3;
const custo: Record<Alvo, { msPorKb: number; amostras: number }> = {
  main: { msPorKb: 0.004, amostras: 0 },
  worker: { msPorKb: 0.003, amostras: 0 },
};

function aprender(alvo: Alvo, kb: number, ms: number) {
  if (kb < 1) return; // tiny bodies are all fixed cost and would skew the per-KB rate
  const c = custo[alvo];
  const taxa = ms / kb;
  c.msPorKb = c.amostras === 0 ? taxa : c.msPorKb + ALFA * (taxa - c.msPorKb);
  c.amostras++;
}

// ?carga=main|worker pins the choice, for experiments; adaptive otherwise
function estrategiaDaUrl(): Estrategia {
  const s = new URLSearchParams(window.location.search).get("carga");
  return s === "main" || s === "worker" ? s : "adaptive";
}

// --- the worker, started on first use; null once it failed (CSP, an old browser) ---

type Resposta = { id: number; dados?: unknown; parseMs?: number; erro?: string };
type Pendente = { resolve: (r: { dados: unknown; recebidoMs: number; parseMs: number }) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let semWorker: string | null = null;
let proximoId = 1;
const pendentes = new Map<number, Pendente>();

function obterWorker(): Worker | null {
  if (worker || semWorker) return worker;
  try {
    worker = new Worker(new URL("./carga.worker.ts", import.meta.url), { type: "module", name: "sample-erp-clientes" });
    worker.onmessage = (event: MessageEvent<Resposta>) => {
      // the clone is deserialized when .data is first read: that read is the main thread's whole cost
      const t0 = performance.now();
      const { id, dados, parseMs, erro } = event.data;
      const recebidoMs = performance.now() - t0;
      const p = pendentes.get(id);
      pendentes.delete(id);
      if (!p) return;
      if (erro !== undefined) p.reject(new Error(erro));
      else p.resolve({ dados, recebidoMs, parseMs: parseMs ?? 0 });
    };
    worker.onerror = (event) => {
      semWorker = event.message || "worker error";
      for (const p of pendentes.values()) p.reject(new Error(semWorker));
      pendentes.clear();
      worker?.terminate();
      worker = null;
    };
  } catch (err) {
    semWorker = err instanceof Error ? err.message : String(err);
  }
  return worker;
}

function parsearNoWorker(w: Worker, corpo: ArrayBuffer, postMs: { ms: number }) {
  return new Promise<{ dados: unknown; recebidoMs: number; parseMs: number }>((resolve, reject) => {
    const id = proximoId++;
    pendentes.set(id, { resolve, reject });
    const t0 = performance.now();
    w.postMessage({ id, corpo }, [corpo]);
    postMs.ms = performance.now() - t0;
  });
}

// --- the decision ---

type Decisao = {
  alvo: Alvo;
  motivo: string;
  explorou: boolean;
  previstoMainMs: number;
  previstoWorkerMs: number;
  orcamentoMs: number;
  mainBusy: number;
  pressao: string;
};

function decidir(kb: number, aleatorio = Math.random): Decisao {
  const signals = telemetry().signals;
  const mainBusy = signals.mainBusy();
  const pressao = signals.pressure();
  const orcamentoMs = ORCAMENTO_MS * (FATOR_PRESSAO[pressao] ?? 1) * (1 - Math.min(0.8, mainBusy));
  const previstoMainMs = kb * custo.main.msPorKb;
  const previstoWorkerMs = kb * custo.worker.msPorKb;
  const base = { previstoMainMs, previstoWorkerMs, orcamentoMs, mainBusy, pressao, explorou: false };

  const estrategia = estrategiaDaUrl();
  if (estrategia !== "adaptive") return { ...base, alvo: estrategia, motivo: "fixo" };
  if (semWorker) return { ...base, alvo: "main", motivo: "sem-worker" };

  let alvo: Alvo;
  let motivo: string;
  if (previstoMainMs <= orcamentoMs) [alvo, motivo] = ["main", "dentro-do-orcamento"];
  else if (previstoWorkerMs < previstoMainMs) [alvo, motivo] = ["worker", "acima-do-orcamento"];
  else [alvo, motivo] = ["main", "worker-nao-compensa"];

  if (aleatorio() < EPSILON) {
    const outro: Alvo = alvo === "main" ? "worker" : "main";
    if (outro === "worker" || previstoMainMs <= 2 * orcamentoMs) {
      return { ...base, alvo: outro, motivo: `${motivo}+explorar`, explorou: true };
    }
  }
  return { ...base, alvo, motivo };
}

// --- the load ---

export type Medicao = { ms: number; alvo: Alvo };
type Rotulo = { endpoint: "clientes" | "clientes/empresas"; page: number; busca: string; extra?: Record<string, unknown> };

const decoder = new TextDecoder();
const parsearAqui = (corpo: ArrayBuffer): unknown => JSON.parse(decoder.decode(corpo));

// GETs `url` as bytes and parses where decidir() says. ms is the whole load (network, API and HubSpot,
// parse), as the dev timing line shows it.
export async function carregarPagina<T extends { data: unknown[]; totalItems: number }>(
  url: string,
  config: AxiosRequestConfig,
  rotulo: Rotulo,
): Promise<T & Medicao> {
  const t0 = performance.now();
  const relatar = (data: Record<string, unknown>) =>
    telemetry().emit({
      source: "search",
      type: "request",
      ts: performance.now(),
      data: {
        endpoint: rotulo.endpoint,
        page: rotulo.page === 1 ? "first" : "next",
        busca: rotulo.busca.length > 0,
        chars: rotulo.busca.length,
        ...rotulo.extra,
        ...data,
      },
    });

  let corpo: ArrayBuffer;
  try {
    corpo = (await apiClient.get<ArrayBuffer>(url, { ...config, responseType: "arraybuffer" })).data;
  } catch (err) {
    // the error body came as bytes too: decode it so getApiErrorMessage still finds { message }
    if (axios.isAxiosError(err) && err.response?.data instanceof ArrayBuffer) {
      try {
        err.response.data = parsearAqui(err.response.data);
      } catch {
        err.response.data = null;
      }
    }
    relatar({ ok: false, ms: performance.now() - t0, status: axios.isAxiosError(err) ? (err.response?.status ?? null) : null });
    throw err;
  }
  const redeMs = performance.now() - t0;
  const bytes = corpo.byteLength;
  const kb = bytes / 1024;
  const decisao = decidir(kb);

  let dados: T;
  let mainBloqueadoMs: number;
  let parseMs: number;
  const w = decisao.alvo === "worker" ? obterWorker() : null;
  if (w) {
    const post = { ms: 0 };
    const r = await parsearNoWorker(w, corpo, post);
    dados = r.dados as T;
    mainBloqueadoMs = post.ms + r.recebidoMs;
    parseMs = r.parseMs;
    aprender("worker", kb, mainBloqueadoMs);
  } else {
    const p0 = performance.now();
    dados = parsearAqui(corpo) as T;
    const p1 = performance.now();
    mainBloqueadoMs = parseMs = p1 - p0;
    telemetry().signals.markSelf(p0, p1); // our own parse is not "outside" load for the next decision
    aprender("main", kb, mainBloqueadoMs);
  }
  const alvo: Alvo = w ? "worker" : "main";
  const ms = performance.now() - t0;

  relatar({
    ok: true,
    ms,
    redeMs,
    bytes,
    rows: dados.data.length,
    total: dados.totalItems,
    alvo,
    motivo: w || decisao.alvo === "main" ? decisao.motivo : "sem-worker",
    explorou: decisao.explorou,
    previstoMainMs: decisao.previstoMainMs,
    previstoWorkerMs: decisao.previstoWorkerMs,
    orcamentoMs: decisao.orcamentoMs,
    mainBusy: decisao.mainBusy,
    pressao: decisao.pressao,
    mainBloqueadoMs,
    parseMs,
  });
  return { ...dados, ms, alvo };
}
