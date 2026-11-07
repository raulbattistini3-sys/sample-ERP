// The search worker: only the shared core's worker entry (pkg/tablecore/worker/worker.js), so the worker
// runs the same runOp as the main thread and the two give identical results. Vite bundles it from the
// literal `new Worker(new URL("./compute.worker.ts", import.meta.url))` in productEngine.ts.
import "@pkg/tablecore/worker/worker.js";
