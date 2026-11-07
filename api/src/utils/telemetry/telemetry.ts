import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTelemetry } from "../../../../pkg/telemetry/bus.js";
import { ndjsonExporter } from "../../../../pkg/telemetry/exporters.js";

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
