import { createScheduler, openColumnar, WorkerClient, WorkerUnavailable } from "@pkg/tablecore/index.js";
import { telemetry } from "../../../lib/telemetry";

type Dataset = import("@pkg/tablecore/types.js").Dataset;
type Strategy = import("@pkg/tablecore/types.js").Strategy;
export type Scheduler = ReturnType<typeof createScheduler>;

// The local search engine for one snapshot: the columnar dataset (typed-array views over the downloaded
// buffer, nothing parsed), a Web Worker holding its own copy, and the shared core's scheduler, which
// decides per search whether to run on the main thread or in the worker from a cost model it keeps
// learning on this device (pkg/tablecore/scheduler.js), and reports each decision to telemetry.
export type ProductEngine = {
  dataset: Dataset;
  scheduler: Scheduler;
  worker: WorkerClient | null;
  // why there is no worker (CSP, an old browser), null when there is one
  workerError: string | null;
  etag: string | null;
  dispose: () => void;
};

const STRATEGIES: Strategy[] = ["adaptive", "main", "worker", "fixed"];

// ?strategy=main|worker|fixed|adaptive pins the scheduler, for experiments; adaptive otherwise
function strategyFromUrl(): Strategy {
  const s = new URLSearchParams(window.location.search).get("strategy") as Strategy | null;
  return s && STRATEGIES.includes(s) ? s : "adaptive";
}

export async function createProductEngine(buffer: ArrayBuffer, etag: string | null): Promise<ProductEngine> {
  const t = telemetry();
  const t0 = performance.now();
  const dataset = openColumnar(buffer);

  let worker: WorkerClient | null = null;
  let workerError: string | null = null;
  try {
    // clone: the worker gets its own copy (one memcpy now) and the page keeps the buffer to render rows
    // and to run small searches itself. Shared memory would avoid the copy but needs cross-origin isolation.
    worker = await WorkerClient.create(
      () => new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module", name: "sample-erp-search" }),
      { dataset, mode: "clone" },
    );
  } catch (err) {
    workerError = err instanceof WorkerUnavailable ? `${err.reason}: ${err.message}` : String(err);
  }

  const scheduler = createScheduler({ dataset, worker, signals: t.signals, strategy: strategyFromUrl(), emit: t.emit });
  // true once the warm-up below is done (or there is none): from then on no search waits on index
  // building, so none falls back to the server (useLocalProducts). For DevTools and the e2e tests.
  const flags = window as unknown as { __erpSearchWarm?: boolean };
  flags.__erpSearchWarm = false;
  t.emit({
    source: "products",
    type: "engine-ready",
    ts: performance.now(),
    data: {
      rows: dataset.rows,
      bytes: buffer.byteLength,
      openMs: performance.now() - t0,
      handoffMs: worker?.handoffMs ?? null,
      workerInitMs: worker?.initMs ?? null,
      workerError,
      strategy: scheduler.strategy,
    },
  });

  // Warm the worker while the user reads the first page: its name indexes and lowercased SKUs are built
  // there, off the main thread, so the first search doesn't pay for them. The scheduler learns the
  // worker's costs (and that its caches are warm) from these runs; the main thread stays cold, so the
  // cost model sends big text searches to the worker until the main thread has caches of its own.
  if (worker && dataset.rows > 0) {
    const warm = async () => {
      // a typo'd word, so both the name index and its trigram index get built
      await scheduler.run({ filters: [{ column: "name", op: "fuzzy", value: "xqzwv" }] }, { strategy: "worker", channel: "warmup" });
      await scheduler.run({ filters: [{ column: "sku", op: "contains", value: "a" }] }, { strategy: "worker", channel: "warmup" });
    };
    warm()
      .catch(() => {
        // a failed warm-up only means the first search pays for the caches
      })
      .finally(() => {
        flags.__erpSearchWarm = true;
      });
  } else {
    flags.__erpSearchWarm = true;
  }

  return {
    dataset,
    scheduler,
    worker,
    workerError,
    etag,
    dispose: () => worker?.terminate(),
  };
}
