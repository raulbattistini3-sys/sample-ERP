import { createTelemetry, defaultCollectors, fetchExporter, memoryExporter, signalsExporter } from "@pkg/telemetry/index.js";
import { getToken } from "./auth-storage";

// The app's telemetry bus (pkg/telemetry), started on first use:
// - collectors: long animation frames, interactions (INP), compute pressure, JS heap
// - signals: the recent main-thread load and pressure, which the search scheduler reads to decide main
//   thread or worker (features/produtos/search)
// - memory: the last events, readable as window.__erpTelemetry.events (DevTools, the e2e tests)
// - fetch: batches to the API's POST /telemetry, which appends them to TELEMETRY_DIR as NDJSON; skipped
//   while signed out
//
// Timings only, never row data: the events say which thread ran a search and how long it took, not
// what was searched.

type Telemetry = {
  emit: ReturnType<typeof createTelemetry>["emit"];
  signals: ReturnType<typeof signalsExporter>;
  events: ReturnType<typeof memoryExporter>["events"];
};

let instance: Telemetry | null = null;

export function telemetry(): Telemetry {
  if (instance) return instance;
  const signals = signalsExporter();
  const log = memoryExporter({ max: 2000 });
  const remote = fetchExporter({
    url: `${import.meta.env.VITE_API_URL}/telemetry`,
    headers: () => {
      const token = getToken();
      return token ? { Authorization: `Bearer ${token}` } : null;
    },
  });
  const bus = createTelemetry({ collectors: defaultCollectors(), exporters: [signals.exporter, log.exporter, remote] });
  bus.start();
  instance = { emit: bus.emit, signals, events: log.events };
  (window as unknown as { __erpTelemetry: Telemetry }).__erpTelemetry = instance;
  return instance;
}
