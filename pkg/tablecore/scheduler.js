// Decides, per operation, whether to run on the main thread or the worker,
// runs it, measures it, and feeds the result back into the cost model.
//
// Adaptive rule:
//   budget = B · pressureFactor · (1 − min(0.8, mainBusy))
//   main   if T_main ≤ budget        (fits in the blocking budget: no worker cost)
//   worker otherwise
//   with probability ε try the other side, so both coefficients stay fresh;
//   main is only explored when T_main ≤ 2·budget, so exploring never causes a big jank.

import { isWarm, narrowedRows, runOp, stringNeeds } from "./compute.js";
import { CostModel } from "./cost-model.js";

/** @typedef {import("./types.js").Dataset} Dataset */
/** @typedef {import("./types.js").OpSpec} OpSpec */
/** @typedef {import("./types.js").Strategy} Strategy */
/** @typedef {import("./types.js").Target} Target */
/** @typedef {import("./types.js").TelemetryEvent} TelemetryEvent */
/** @typedef {import("./worker/client.js").WorkerClient} WorkerClient */
/** @typedef {import("./worker/client.js").WorkerTiming} WorkerTiming */
/** @typedef {import("./worker/protocol.js").OpStats} OpStats */
/** @typedef {import("../telemetry/exporters.js").Signals} Signals */
/** @typedef {import("./cost-model.js").Estimate} Estimate */

/** @type {Record<string, number>} */
const PRESSURE_FACTOR = { nominal: 1, fair: 1, serious: 0.75, critical: 0.5 };

/**
 * @typedef {object} Decision
 * @property {Strategy} strategy
 * @property {Target} target
 * @property {string} reason
 * @property {boolean} explored
 * @property {Estimate} estimate
 * @property {number} predMainMs
 * @property {number} predWorkerMs
 * @property {number} coldMain strings the main thread still has to decode
 * @property {number} coldWorker strings the worker still has to decode
 * @property {number} budgetMs
 * @property {number} mainBusy
 * @property {string} pressure
 */

/**
 * @typedef {object} Timing
 * @property {number} totalMs time to result
 * @property {number} mainBlockedMs main-thread time this run took (compute on main; postMessage on worker)
 * @property {WorkerTiming} [worker] breakdown, worker runs only
 */

/**
 * @typedef {{ stale: true, decision: Decision }
 *   | { stale: false, decision: Decision, target: Target, indices: Uint32Array, stats: OpStats, timing: Timing }} RunOutcome
 */

/**
 * @typedef {object} SchedulerOptions
 * @property {Dataset} dataset
 * @property {WorkerClient | null} worker null when CSP or the browser denied one
 * @property {Signals | null} [signals]
 * @property {Strategy} [strategy]
 * @property {number} [budgetMs] blocking budget; 50 ms is the long-task threshold
 * @property {number} [epsilon] exploration rate
 * @property {number} [fixedThreshold] rows at which the `fixed` strategy switches to the worker
 * @property {CostModel} [model]
 * @property {(e: TelemetryEvent) => void} [emit]
 * @property {() => number} [random] injectable for tests
 */

/** @param {SchedulerOptions} options */
export function createScheduler(options) {
  const { dataset, worker, signals = null, emit = () => {}, random = Math.random } = options;
  const model = options.model ?? new CostModel();
  let strategy = options.strategy ?? "adaptive";
  let budgetMs = options.budgetMs ?? 50;
  let epsilon = options.epsilon ?? 0.05;
  let fixedThreshold = options.fixedThreshold ?? 50_000;
  /** String caches the worker has built, learned from its successful runs. */
  const workerWarm = new Set();

  /**
   * @param {OpSpec} spec
   * @param {Strategy} [override]
   * @returns {Decision}
   */
  function decide(spec, override) {
    const s = override ?? strategy;
    const estimate = model.estimate(dataset, spec);
    const needs = stringNeeds(dataset, spec);
    const coldMain = needs.reduce((sum, n) => sum + (isWarm(n) ? 0 : n.dict.count), 0);
    const coldWorker = needs.reduce((sum, n) => sum + (workerWarm.has(n.key) ? 0 : n.dict.count), 0);
    // main narrows from its own last result when the spec only tightens it; the worker's last result
    // isn't known here, so its prediction assumes a full run
    const mainRows = narrowedRows(dataset, spec);
    const predMainMs = model.predict("main", mainRows === null ? estimate : { ...estimate, scanUnits: mainRows }, coldMain);
    const predWorkerMs = model.predict("worker", estimate, coldWorker);
    const mainBusy = signals?.mainBusy() ?? 0;
    const pressure = signals?.pressure() ?? "unknown";
    const budget = budgetMs * (PRESSURE_FACTOR[pressure] ?? 1) * (1 - Math.min(0.8, mainBusy));
    const base = { strategy: s, explored: false, estimate, predMainMs, predWorkerMs, coldMain, coldWorker, budgetMs: budget, mainBusy, pressure };

    if (!worker) return { ...base, target: "main", reason: "no-worker" };
    switch (s) {
      case "main":
        return { ...base, target: "main", reason: "static" };
      case "worker":
        return { ...base, target: "worker", reason: "static" };
      case "fixed":
        return { ...base, target: estimate.n >= fixedThreshold ? "worker" : "main", reason: `n${estimate.n >= fixedThreshold ? "≥" : "<"}${fixedThreshold}` };
      case "adaptive": {
        /** @type {Target} */
        let target = predMainMs <= budget ? "main" : "worker";
        let reason = target === "main" ? "within-budget" : "over-budget";
        let explored = false;
        if (random() < epsilon) {
          const other = target === "main" ? "worker" : "main";
          if (other === "worker" || predMainMs <= 2 * budget) {
            target = other;
            reason += "+explore";
            explored = true;
          }
        }
        return { ...base, target, reason, explored };
      }
    }
  }

  /**
   * @param {OpSpec} spec
   * @param {OpStats} stats
   * @param {WorkerTiming} timing
   */
  function learnWorker(spec, stats, timing) {
    // Queued runs measure backlog, not the fixed cost: learn compute only.
    model.observe("worker", spec, stats, timing.queuedBehind === 0 ? timing.postMs + timing.toWorkerMs + timing.replyMs : undefined);
    for (const n of stringNeeds(dataset, spec)) workerWarm.add(n.key);
  }

  /**
   * @param {OpSpec} spec
   * @param {Decision} decision
   * @returns {RunOutcome}
   */
  function runMain(spec, decision) {
    const t0 = performance.now();
    const { indices, ...stats } = runOp(dataset, spec);
    const t1 = performance.now();
    signals?.markSelf(t0, t1);
    model.observe("main", spec, stats);
    return { stale: false, decision, target: "main", indices, stats, timing: { totalMs: t1 - t0, mainBlockedMs: t1 - t0 } };
  }

  /**
   * True when this spec would wait on index building: it goes to the worker (the main thread is too slow
   * for it) and the worker hasn't built a cache it needs yet, so it would queue behind the warm-up or
   * build the cache itself (seconds on a big table). The app can answer it some other way meanwhile (the
   * server), and keep the local result for when it lands. Strategy "main" never waits on the worker.
   *
   * @param {OpSpec} spec
   * @param {Strategy} [override]
   */
  function coldFor(spec, override) {
    if (!worker) return false;
    const d = decide(spec, override);
    if (d.target !== "worker") return false;
    return stringNeeds(dataset, spec).some((n) => !workerWarm.has(n.key));
  }

  return {
    model,
    decide,
    coldFor,

    /**
     * Runs one operation where the strategy says. On a newer run in the same
     * channel, an older worker run resolves `stale: true`.
     *
     * @param {OpSpec} spec
     * @param {{ channel?: string, strategy?: Strategy }} [opts]
     * @returns {Promise<RunOutcome>}
     */
    async run(spec, { channel = "default", strategy: override } = {}) {
      const decision = decide(spec, override);
      emit({ source: "scheduler", type: "decision", ts: performance.now(), data: flatDecision(decision) });

      /** @type {RunOutcome} */
      let outcome;
      if (decision.target === "main" || !worker) {
        outcome = runMain(spec, decision);
      } else {
        try {
          const r = await worker.run(spec, channel);
          if (r.stale) {
            if (r.stats && r.timing) learnWorker(spec, r.stats, r.timing);
            emit({ source: "scheduler", type: "stale", ts: performance.now(), data: { id: r.id } });
            return { stale: true, decision };
          }
          learnWorker(spec, r.stats, r.timing);
          outcome = {
            stale: false,
            decision,
            target: "worker",
            indices: r.indices,
            stats: r.stats,
            timing: { totalMs: r.timing.totalMs, mainBlockedMs: r.timing.postMs, worker: r.timing },
          };
        } catch (err) {
          emit({ source: "scheduler", type: "worker-error", ts: performance.now(), data: { message: String(err) } });
          outcome = runMain(spec, { ...decision, target: "main", reason: "worker-failed" });
        }
      }

      if (!outcome.stale) {
        emit({
          source: "scheduler",
          type: "result",
          ts: performance.now(),
          data: {
            target: outcome.target,
            n: decision.estimate.n,
            matched: outcome.stats.matched,
            sortClass: outcome.stats.sortClass,
            totalMs: outcome.timing.totalMs,
            mainBlockedMs: outcome.timing.mainBlockedMs,
            computeMs: outcome.stats.filterMs + outcome.stats.sortMs,
            prepareMs: outcome.stats.prepareMs,
            prepared: outcome.stats.prepared,
            predMs: outcome.target === "main" ? decision.predMainMs : decision.predWorkerMs,
            ...(outcome.timing.worker ?? {}),
          },
        });
      }
      return outcome;
    },

    /**
     * Seeds both sides of the model with small runs so the first real decision
     * isn't made on priors alone. Run it when the page is idle.
     *
     * @param {OpSpec[]} specs
     */
    async calibrate(specs) {
      for (const spec of specs) {
        runMain(spec, decide(spec, "main"));
        if (worker) {
          const r = await worker.run(spec, "calibrate");
          if (r.stats && r.timing) learnWorker(spec, r.stats, r.timing);
        }
      }
      emit({ source: "scheduler", type: "calibrated", ts: performance.now(), data: model.snapshot() });
    },

    get strategy() {
      return strategy;
    },
    /** @param {{ strategy?: Strategy, budgetMs?: number, epsilon?: number, fixedThreshold?: number }} o */
    configure(o) {
      strategy = o.strategy ?? strategy;
      budgetMs = o.budgetMs ?? budgetMs;
      epsilon = o.epsilon ?? epsilon;
      fixedThreshold = o.fixedThreshold ?? fixedThreshold;
    },
  };
}

/** @typedef {ReturnType<typeof createScheduler>} Scheduler */

/**
 * @param {Decision} d
 * @returns {Record<string, unknown>}
 */
function flatDecision(d) {
  return {
    strategy: d.strategy,
    target: d.target,
    reason: d.reason,
    explored: d.explored,
    n: d.estimate.n,
    m: d.estimate.m,
    sortClass: d.estimate.sortClass,
    predMainMs: d.predMainMs,
    predWorkerMs: d.predWorkerMs,
    coldMain: d.coldMain,
    coldWorker: d.coldWorker,
    budgetMs: d.budgetMs,
    mainBusy: d.mainBusy,
    pressure: d.pressure,
  };
}
