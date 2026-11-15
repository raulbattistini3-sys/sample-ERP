import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTelemetry } from "../../../../pkg/telemetry/bus.js";
import { ndjsonExporter } from "../../../../pkg/telemetry/exporters.js";
import { createHostTelemetry } from "../../../../pkg/telemetry/host.js";

// Telemetry sink of this process, built from the shared package (pkg/telemetry): the API's own events
// (how long a product snapshot took to build) and the batches the web posts to /telemetry, one JSON
// object per line in TELEMETRY_DIR/<yyyy-mm-dd>.ndjson. Without TELEMETRY_DIR events are dropped; the
// launcher sets it to data/telemetry.

const dir = process.env.TELEMETRY_DIR?.trim() || null;
let made: Promise<unknown> | null = null;
// appends run one after the other, so lines from one batch stay together and in order
let tail: Promise<unknown> = Promise.resolve();

function write(line: string) {
   if (!dir) return;
   made ??= mkdir(dir, { recursive: true });
   const file = join(dir, `${new Date().toISOString().slice(0, 10)}.ndjson`);
   tail = tail
      .then(() => made)
      .then(() => appendFile(file, line))
      .catch(() => {
         // a full disk or a missing folder must never fail a request; telemetry is best effort
      });
}

export const telemetryEnabled = dir !== null;

const bus = createTelemetry({ collectors: [], exporters: [ndjsonExporter({ write, base: { service: "api" } })] });
let started = false;

// one event from the API itself; `ts` is this process's clock, `at` the wall clock
export function emitApi(type: string, data: Record<string, unknown>) {
   if (!dir) return;
   if (!started) {
      started = true;
      bus.start(); // writes a "capabilities" line first: cpu count and runtime of this host
   }
   bus.emit({ source: "api", type, ts: performance.now(), data: { ...data, at: new Date().toISOString() } });
}

export type WebEvent = { source: string; type: string; ts: number; data: Record<string, unknown> };

// a batch from the web's telemetry bus, tagged with who sent it and when it arrived
export function recordWebEvents(usuarioId: string, events: WebEvent[]) {
   if (!dir) return;
   const exporter = ndjsonExporter({ write, base: { service: "web", usuario: usuarioId, receivedAt: new Date().toISOString() } });
   for (const e of events) exporter.export(e);
}

// ─── host telemetry: what the API measures about itself (pkg/telemetry/host.js) ─────────────────────
// Memory, GC pauses, event-loop delay and utilization, requests per route and queries per label,
// aggregated every 10 s into one envelope, written as one line { service: "api", type: "host", ... } to
// the same NDJSON files. start() only when TELEMETRY_DIR is set; the middleware's Server-Timing header
// works either way.
export const hostTelemetry = createHostTelemetry({
   source: "sample-erp-api",
   send: async (envelope) => write(JSON.stringify({ service: "api", type: "host", ...envelope }) + "\n"),
});

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
