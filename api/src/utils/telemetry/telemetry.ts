import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createHostTelemetry, httpSender } from "../../../../pkg/telemetry/host.js";
import { createIngestChild } from "../../../../pkg/telemetry/ingest-child.js";

// Telemetry sink of this process. Everything goes to the TCC telemetry server (tcc-v2.exe, a sibling
// process the launcher and `network dev` start), never to local files:
// - app events: the API's own (how long a product snapshot took to build) and the batches the web posts
//   to /telemetry (product search engine/query timings, Empresa list loads), batched to
//   POST <tcc>/telemetry/events every 2 s or 200 events;
// - host telemetry: memory, GC, event loop, requests and queries every 10 s to POST <tcc>/telemetry/host.
// TCC_TELEMETRY_URL is the host endpoint (".../telemetry/host"); the events endpoint is its sibling.
// Without it both are off and events are dropped. TCC being down never affects the API: batches wait in a
// bounded queue and the oldest are dropped when it's full.

const hostUrl = process.env.TCC_TELEMETRY_URL?.trim() || null;
const token = process.env.TCC_TOKEN?.trim() ?? "";
const eventsUrl = hostUrl ? hostUrl.replace(/\/telemetry\/host\/?$/, "") + "/telemetry/events" : null;
const instanceId = process.env.TELEMETRY_INSTANCE_ID?.trim() || `${hostname()}:sample-erp-api`;
const bootId = randomUUID();

export const telemetryEnabled = eventsUrl !== null;

type AppEvent = { service: string; source: string; type: string; ts: number; at: string; user?: string; data: Record<string, unknown> };
type Batch = { version: 1; source: string; instanceId: string; bootId: string; sequence: number; timestamp: string; events: AppEvent[] };

const FLUSH_MS = 2000;
const BATCH_MAX = 200;
const QUEUE_MAX = 300; // batches kept while TCC is down (~10 min of a busy API), then the oldest go

let pending: AppEvent[] = [];
const queue: Batch[] = [];
let sequence = 0;
let timer: NodeJS.Timeout | null = null;
let sending: Promise<void> | null = null;
const send = eventsUrl ? httpSender(eventsUrl, token) : null;

function seal() {
   if (pending.length === 0) return;
   queue.push({ version: 1, source: "sample-erp", instanceId, bootId, sequence: sequence++, timestamp: new Date().toISOString(), events: pending });
   pending = [];
   while (queue.length > QUEUE_MAX) queue.shift();
}

async function drain() {
   while (queue.length > 0 && send) {
      try {
         await send(queue[0] as never);
         queue.shift();
      } catch (err) {
         // 400 is a batch TCC will never take: drop it rather than block the queue behind it
         if (String(err).includes("HTTP 400")) queue.shift();
         else return;
      }
   }
}

function flush(): Promise<void> {
   seal();
   sending ??= drain().finally(() => (sending = null));
   return sending;
}

function push(e: AppEvent) {
   if (!send) return;
   pending.push(e);
   if (pending.length >= BATCH_MAX) void flush();
   timer ??= setInterval(() => void flush(), FLUSH_MS);
   timer.unref?.();
}

// who did it, without saying who: the same user always maps to the same hash (so sessions can be
// compared across restarts); TCC never gets the id itself
const userHash = (id: string) => createHash("sha256").update(`sample-erp:${id}`).digest("hex").slice(0, 16);

// one event from the API itself; `ts` is this process's clock
export function emitApi(type: string, data: Record<string, unknown>) {
   push({ service: "api", source: "api", type, ts: performance.now(), at: new Date().toISOString(), data });
}

export type WebEvent = { source: string; type: string; ts: number; data: Record<string, unknown> };

// a batch from the web's telemetry bus, tagged with who sent it (hashed) and when it arrived
export function recordWebEvents(usuarioId: string, events: WebEvent[]) {
   const at = new Date().toISOString();
   const user = userHash(usuarioId);
   for (const e of events) push({ service: "web", source: e.source, type: e.type, ts: e.ts, at, user, data: e.data ?? {} });
}

/** sends what's left; called on shutdown */
export async function flushTelemetry(): Promise<void> {
   if (timer) clearInterval(timer);
   timer = null;
   await Promise.race([flush(), new Promise((r) => setTimeout(r, 3000))]);
}

// ─── host telemetry: what the API measures about itself (pkg/telemetry/host.js) ─────────────────────
// Memory, GC pauses, event-loop delay and utilization, requests per route and queries per label,
// aggregated every 10 s into one envelope and sent to TCC with TCC_TOKEN. The middleware's
// Server-Timing header works either way. A failed send keeps the envelope in the bounded queue (360 = 1 h).
//
// With TCC_INGEST_EXE (the launcher sets it to tcc-v2.exe) the envelopes don't go over HTTP at all: the API
// starts tcc-v2.exe in ingest-ipc mode as its own child and sends them over Node's IPC channel; the child
// stores them in the TCC database and acks each (pkg/telemetry/ingest-child.js). Being the API's child,
// it sits in the API's job object (the launcher's memory limit, named by WIN_TELEMETRY_JOB) and reports
// the job back every second: those win.job / win.system readings ride along in the API's envelopes, and
// ipcTelemetry.job() is the limit the API actually runs under. Until the child is ready, or if it's
// gone, envelopes take the HTTP path (TCC_TELEMETRY_URL; via erp-cache, which answers resends itself).
const toTcc = hostUrl ? httpSender(hostUrl, token) : null;
const ingestExe = process.env.TCC_INGEST_EXE?.trim() || null;
const ingestArgs = process.env.TCC_INGEST_ARGS?.trim() ? process.env.TCC_INGEST_ARGS.trim().split(/\s+/) : [];

let ingest: ReturnType<typeof createIngestChild> | null = null;

export const hostTelemetryEnabled = toTcc !== null || ingestExe !== null;

/** the IPC telemetry child, once startHostTelemetry() has started it */
export const ipcTelemetry = {
   get ready() {
      return ingest?.ready ?? false;
   },
   job: () => ingest?.job() ?? null,
   stats: () => ingest?.stats ?? null,
};

export const hostTelemetry = createHostTelemetry({
   source: "sample-erp-api",
   instanceId: process.env.TELEMETRY_INSTANCE_ID?.trim() || undefined,
   extraSamples: () => ingest?.extraSamples() ?? [],
   send: async (envelope) => {
      if (ingest?.ready) {
         try {
            await ingest.send(envelope);
            return;
         } catch (err) {
            if (!toTcc) throw err; // stays queued for the child
         }
      }
      if (toTcc) await toTcc(envelope);
      else if (ingest) throw new Error("telemetry child not ready"); // stays queued until it is
   },
});

/** starts host telemetry and, with TCC_INGEST_EXE, the IPC telemetry child (the API process only) */
export function startHostTelemetry() {
   if (!hostTelemetryEnabled) return;
   if (ingestExe && !ingest) {
      ingest = createIngestChild({
         exe: ingestExe,
         args: ingestArgs,
         // the child inherits TCC_INGEST_DATABASE_URL/_SSL/_CA_CERT (the TCC database, from the launcher)
         // and WIN_TELEMETRY_JOB
         log: (m) => console.log(`[telemetry] ${m}`),
      });
   }
   hostTelemetry.start();
}

/** the last window ("stopping" included), then the child */
export async function stopHostTelemetry() {
   if (!hostTelemetryEnabled) return;
   await hostTelemetry.stop();
   await ingest?.stop();
}

// "select produtos", "insert auditorias": the verb and the first table of a statement. Telemetry is
// training data, so the label never carries the SQL text or its values.
export function queryLabel(text: string): string {
   const verb = /^\s*(\w+)/.exec(text)?.[1]?.toLowerCase() ?? "query";
   const table = /\b(?:from|into|update)\s+"?([\w.]+)"?/i.exec(text)?.[1];
   return table ? `${verb} ${table}` : verb;
}

type QueryablePool = { query: (...args: unknown[]) => unknown };

// counts every promise-style pool.query (what drizzle calls outside transactions) under db.query and in
// the request's Server-Timing "db". Callback-style calls pass through untimed; queries inside a
// transaction run on a checked-out client (pool.connect) and aren't counted.
export function instrumentPool<P extends object>(pool: P): P {
   const p = pool as unknown as QueryablePool;
   const original = p.query.bind(pool);
   p.query = (...args: unknown[]) => {
      if (typeof args[args.length - 1] === "function") return original(...args);
      const first = args[0] as string | { text?: unknown } | undefined;
      const text = typeof first === "string" ? first : typeof first?.text === "string" ? first.text : "";
      return hostTelemetry.query(queryLabel(text), () => original(...args) as Promise<unknown>);
   };
   return pool;
}
