// Table core: a typed-array columnar table (one ArrayBuffer, zero-copy views), the filter/sort both
// threads run, an inverted text index, a Web Worker that runs the same code, a per-device cost
// model and the scheduler that picks main thread or worker per operation.
//
// From the TCC prototype (experiments/tcc-v1/src, commit d478a1d), unchanged except: the folders are
// flattened, numeric `in` filters and `fuzzy` search were added (compute.js, fuzzy.js,
// similarity.js), and telemetry moved to ../telemetry.
// The prototype's start() is left out: it fetches the data itself, while an app usually needs its
// own client (auth, errors), so the app wires these pieces together.
//
// The worker entry is worker/worker.js; a bundler needs a literal
//   new Worker(new URL("./my.worker.js", import.meta.url), { type: "module" })
// in the app, whose entry is just `import "<pkg>/tablecore/worker/worker.js"`.

export { openColumnar, encodeColumnar, toShared, dictString, dictStrings, cellText, NULL_I32, NULL_U8 } from "./columnar.js";
export { runOp, textIndexStats, trigramIndexStats, stringNeeds, isWarm } from "./compute.js";
export { fuzzyMatchCodes, buildTrigramIndex } from "./fuzzy.js";
export { fold, levenshtein, osa, prefixOsa, jaroWinkler, trigrams, trigramCosine, maxEditsFor } from "./similarity.js";
export { tokenize } from "./text-index.js";
export { CostModel } from "./cost-model.js";
export { createScheduler } from "./scheduler.js";
export { WorkerClient, WorkerUnavailable } from "./worker/client.js";
