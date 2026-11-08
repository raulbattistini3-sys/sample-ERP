// Page-side handle on the compute worker: request ids, stale-reply handling,
// and a timing breakdown of where worker time goes.

import { now } from "./protocol.js";

/** @typedef {import("./protocol.js").ToWorker} ToWorker */
/** @typedef {import("./protocol.js").FromWorker} FromWorker */
/** @typedef {import("./protocol.js").InitMode} InitMode */
/** @typedef {import("./protocol.js").OpStats} OpStats */
/** @typedef {import("../types.js").OpSpec} OpSpec */
/** @typedef {import("../types.js").Dataset} Dataset */

/**
 * Where the time of one worker run went, in ms. `postMs` is the only part
 * that blocks the main thread (plus applying the result, measured elsewhere).
 * @typedef {object} WorkerTiming
 * @property {number} postMs main thread inside postMessage (cloning the request)
 * @property {number} toWorkerMs post returned → worker received
 * @property {number} queueMs worker received → compute started
 * @property {number} computeMs inside runOp
 * @property {number} replyMs compute ended → page received (grows when the main thread is busy)
 * @property {number} totalMs time to result
 * @property {number} queuedBehind requests still in flight when this one was posted. While the
 *   worker computes, it can't even receive the next message, so for queued runs the backlog
 *   shows up in toWorkerMs; only runs with 0 here measure the fixed messaging cost.
 */

/**
 * A stale run may still carry `stats`/`timing` (it ran, but a newer one
 * superseded it): the result is dropped, the measurement is still valid.
 * @typedef {{ stale: true, id: number, stats?: OpStats, timing?: WorkerTiming }
 *   | { stale: false, id: number, indices: Uint32Array, stats: OpStats, timing: WorkerTiming }} WorkerRun
 */

/**
 * Why a worker could not be used. `csp` means the page's Content Security
 * Policy refused the script (worker-src / script-src).
 * @typedef {"csp" | "load-error" | "timeout" | "unsupported"} WorkerFailure
 */

export class WorkerUnavailable extends Error {
  /**
   * @param {WorkerFailure} reason
   * @param {string} detail
   */
  constructor(reason, detail) {
    super(`worker unavailable (${reason}): ${detail}`);
    this.reason = reason;
  }
}

export class WorkerClient {
  /** @type {Worker} */
  #worker;
  #nextId = 1;
  /** @type {Map<number, { resolve: (r: WorkerRun) => void, reject: (e: Error) => void, t0: number, tPosted: number, postMs: number, queuedBehind: number }>} */
  #pending = new Map();
  /** @type {Map<string, number>} */
  #latest = new Map();

  /** Rows the worker reported at init. */
  rows = 0;
  /** Time the worker spent opening the dataset. */
  initMs = 0;
  /** Main-thread time spent handing the dataset over (the clone, if any). */
  handoffMs = 0;
  /** @type {InitMode} */
  mode = "clone";

  /** @param {Worker} worker */
  constructor(worker) {
    this.#worker = worker;
    worker.onmessage = (/** @type {MessageEvent<FromWorker>} */ e) => this.#onMessage(e.data);
  }

  /**
   * Starts a worker and hands it the dataset. Rejects with WorkerUnavailable
   * when CSP or anything else stops the worker, so callers can fall back to
   * the main thread.
   *
   * @param {URL | string | (() => Worker)} url a script URL, or a factory so a bundler
   *   (Vite, Angular) can see the literal `new Worker(new URL(...))` and bundle the worker
   * @param {{ dataset: Dataset, mode?: InitMode, dataUrl?: string, timeoutMs?: number }} options
   * @returns {Promise<WorkerClient>}
   */
  static async create(url, { dataset, mode, dataUrl, timeoutMs = 10_000 }) {
    if (typeof Worker === "undefined") throw new WorkerUnavailable("unsupported", "no Worker in this context");

    /** @type {SecurityPolicyViolationEvent | null} */
    let violation = null;
    /** @param {SecurityPolicyViolationEvent} e */
    const onViolation = (e) => {
      if (e.effectiveDirective === "worker-src" || e.effectiveDirective === "script-src" || e.effectiveDirective === "child-src") violation = e;
    };
    document.addEventListener("securitypolicyviolation", onViolation);

    /** @type {Worker} */
    let worker;
    try {
      worker = typeof url === "function" ? url() : new Worker(url, { type: "module", name: "tcc-compute" });
    } catch (err) {
      document.removeEventListener("securitypolicyviolation", onViolation);
      // Chromium throws synchronously when CSP blocks the worker script.
      throw new WorkerUnavailable(String(err).includes("Content Security Policy") ? "csp" : "load-error", String(err));
    }

    const resolvedMode = mode ?? (globalThis.crossOriginIsolated && dataset.buffer instanceof SharedArrayBuffer ? "shared" : "clone");
    const client = new WorkerClient(worker);
    client.mode = resolvedMode;

    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new WorkerUnavailable("timeout", `no ready after ${timeoutMs} ms`)), timeoutMs);
        worker.addEventListener("error", (e) => {
          clearTimeout(timer);
          e.preventDefault();
          reject(new WorkerUnavailable(violation ? "csp" : "load-error", e.message || "worker script failed to load"));
        });
        worker.addEventListener("message", function onReady(/** @type {MessageEvent<FromWorker>} */ e) {
          if (e.data.type === "ready") {
            clearTimeout(timer);
            worker.removeEventListener("message", onReady);
            resolve(e.data);
          } else if (e.data.type === "error" && e.data.id === null) {
            clearTimeout(timer);
            reject(new WorkerUnavailable("load-error", e.data.message));
          }
        });

        const t0 = performance.now();
        /** @type {ToWorker} */
        const init =
          resolvedMode === "fetch"
            ? { type: "init", mode: "fetch", url: new URL(dataUrl ?? "", location.href).href }
            : { type: "init", mode: resolvedMode, buffer: dataset.buffer };
        // No transfer list: the page keeps its copy to compute and render.
        // With `clone` this line is a full memcpy of the dataset on the main thread.
        worker.postMessage(init);
        client.handoffMs = performance.now() - t0;
      });
      const r = /** @type {Extract<FromWorker, { type: "ready" }>} */ (ready);
      client.rows = r.rows;
      client.initMs = r.initMs;
      return client;
    } catch (err) {
      worker.terminate();
      throw err;
    } finally {
      document.removeEventListener("securitypolicyviolation", onViolation);
    }
  }

  /**
   * Runs an operation. A newer run on the same channel makes older replies
   * stale: they resolve with `stale: true` and their indices are dropped.
   *
   * @param {OpSpec} spec
   * @param {string} [channel]
   * @returns {Promise<WorkerRun>}
   */
  run(spec, channel = "default") {
    const id = this.#nextId++;
    this.#latest.set(channel, id);
    return new Promise((resolve, reject) => {
      const queuedBehind = this.#pending.size;
      const t0 = now();
      /** @type {ToWorker} */
      const msg = { type: "run", id, channel, spec };
      this.#worker.postMessage(msg);
      const tPosted = now();
      this.#pending.set(id, { resolve, reject, t0, tPosted, postMs: tPosted - t0, queuedBehind });
    });
  }

  /** Round trip with no work: the fixed messaging cost right now. */
  ping() {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const t0 = now();
      this.#pending.set(id, {
        resolve: () => resolve(now() - t0),
        reject: () => resolve(NaN),
        t0,
        tPosted: t0,
        postMs: 0,
        queuedBehind: 0,
      });
      this.#worker.postMessage(/** @type {ToWorker} */ ({ type: "ping", id }));
    });
  }

  terminate() {
    this.#worker.terminate();
    for (const p of this.#pending.values()) p.reject(new Error("worker terminated"));
    this.#pending.clear();
  }

  /** @param {FromWorker} msg */
  #onMessage(msg) {
    if (msg.type === "ready") return;
    const id = msg.id;
    if (id === null) return;
    const p = this.#pending.get(id);
    if (!p) return;
    this.#pending.delete(id);

    switch (msg.type) {
      case "pong":
        p.resolve(/** @type {WorkerRun} */ ({ stale: true, id }));
        return;
      case "error":
        p.reject(new Error(msg.message));
        return;
      case "skipped":
        p.resolve({ stale: true, id });
        return;
      case "result": {
        const tReply = now();
        /** @type {WorkerTiming} */
        const timing = {
            postMs: p.postMs,
            toWorkerMs: Math.max(0, msg.tRecv - p.tPosted),
            queueMs: Math.max(0, msg.tStart - msg.tRecv),
            computeMs: msg.tEnd - msg.tStart,
            replyMs: Math.max(0, tReply - msg.tEnd),
            totalMs: tReply - p.t0,
            queuedBehind: p.queuedBehind,
        };
        if (id !== this.#latest.get(msg.channel)) p.resolve({ stale: true, id, stats: msg.stats, timing });
        else p.resolve({ stale: false, id, indices: msg.indices, stats: msg.stats, timing });
      }
    }
  }
}
