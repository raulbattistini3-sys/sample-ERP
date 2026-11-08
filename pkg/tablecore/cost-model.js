// Per-device cost model.
//
//   T_main(op)   = k_prep,main · D_main + k_scan,main · S + k_sort,main[c] · m·log2(m)·keys
//   T_worker(op) = O + k_prep,worker · D_worker + k_scan,worker · S + k_sort,worker[c] · m·log2(m)·keys
//
// D = strings that thread still has to decode (cold cache, paid once),
// S = rows scanned by filters, m = rows left after filtering (estimated from
// past selectivity), c = comparator class, O = fixed worker overhead (post,
// scheduling, reply). Every coefficient is an EWMA of observed time / units,
// so the model follows the device as throttling or load change.

import { classifySort, sortUnits } from "./compute.js";

/** @typedef {import("./types.js").Dataset} Dataset */
/** @typedef {import("./types.js").OpSpec} OpSpec */
/** @typedef {import("./types.js").SortClass} SortClass */
/** @typedef {import("./types.js").Target} Target */
/** @typedef {import("./worker/protocol.js").OpStats} OpStats */

/** EWMA that averages its first few samples instead of jumping to the first one. */
export class Ewma {
  /**
   * @param {number} initial prior, used until the first sample
   * @param {number} alpha weight of a new sample once warmed up
   */
  constructor(initial, alpha) {
    this.value = initial;
    this.alpha = alpha;
    this.samples = 0;
  }

  /** @param {number} x */
  update(x) {
    if (!Number.isFinite(x)) return;
    const a = Math.max(this.alpha, 1 / (this.samples + 1));
    this.value += a * (x - this.value);
    this.samples++;
  }
}

/**
 * Starting coefficients in ms per unit, roughly a mid-range laptop. They only
 * matter until the first few samples arrive.
 */
export const DEFAULT_PRIORS = {
  prep: 6e-4,
  scan: 4e-6,
  sort: /** @type {Record<Exclude<SortClass, "none">, number>} */ ({ num: 2e-5, code: 2e-5, locale: 2e-4 }),
  overheadMs: 2,
};

/** Below this many units the timer's resolution is the measurement. */
const MIN_UNITS = 20_000;

/**
 * @typedef {object} Estimate
 * @property {number} n rows taking part
 * @property {number} scanUnits
 * @property {number} m expected rows after filtering
 * @property {number} sortUnits
 * @property {SortClass} sortClass
 */

export class CostModel {
  /**
   * @param {{ alpha?: number, priors?: typeof DEFAULT_PRIORS }} [options]
   */
  constructor({ alpha = 0.25, priors = DEFAULT_PRIORS } = {}) {
    this.alpha = alpha;
    const sorts = () => ({
      num: new Ewma(priors.sort.num, alpha),
      code: new Ewma(priors.sort.code, alpha),
      locale: new Ewma(priors.sort.locale, alpha),
    });
    /** @type {Record<Target, { prep: Ewma, scan: Ewma, sort: Record<Exclude<SortClass, "none">, Ewma> }>} */
    this.k = {
      main: { prep: new Ewma(priors.prep, alpha), scan: new Ewma(priors.scan, alpha), sort: sorts() },
      worker: { prep: new Ewma(priors.prep, alpha), scan: new Ewma(priors.scan, alpha), sort: sorts() },
    };
    this.overhead = new Ewma(priors.overheadMs, alpha);
    /** @type {Map<string, Ewma>} */
    this.selectivity = new Map();
  }

  /**
   * @param {OpSpec} spec
   * @returns {string}
   */
  static filterKey(spec) {
    return (spec.filters ?? []).map((f) => `${f.column}:${f.op}`).join("&");
  }

  /**
   * @param {Dataset} ds
   * @param {OpSpec} spec
   * @returns {Estimate}
   */
  estimate(ds, spec) {
    const n = Math.min(spec.limit ?? ds.rows, ds.rows);
    const filters = spec.filters?.length ?? 0;
    const keys = spec.sort?.length ?? 0;
    const sel = filters === 0 ? 1 : (this.selectivity.get(CostModel.filterKey(spec))?.value ?? 0.5);
    const m = Math.max(0, Math.round(n * sel));
    return { n, scanUnits: n * filters, m, sortUnits: sortUnits(m, keys), sortClass: classifySort(ds, spec.sort ?? []) };
  }

  /**
   * Predicted time to result in ms.
   *
   * @param {Target} target
   * @param {Estimate} est
   * @param {number} [cold] strings this thread still has to decode
   */
  predict(target, est, cold = 0) {
    const k = this.k[target];
    const sort = est.sortClass === "none" ? 0 : k.sort[est.sortClass].value * est.sortUnits;
    const compute = k.prep.value * cold + k.scan.value * est.scanUnits + sort;
    return target === "worker" ? this.overhead.value + compute : compute;
  }

  /**
   * Learns from a finished run.
   *
   * @param {Target} target
   * @param {OpSpec} spec
   * @param {OpStats} stats
   * @param {number} [overheadMs] worker only: messaging time (post + delivery + reply), queue wait excluded
   */
  observe(target, spec, stats, overheadMs) {
    const k = this.k[target];
    if (stats.prepared >= MIN_UNITS) k.prep.update(stats.prepareMs / stats.prepared);
    // per row actually tested: a narrowed run tests far fewer rows than the spec suggests
    const tested = stats.tested ?? stats.scanned;
    if (tested >= MIN_UNITS) k.scan.update(stats.filterMs / tested);
    if (stats.sortClass !== "none" && stats.sortUnits >= MIN_UNITS) k.sort[stats.sortClass].update(stats.sortMs / stats.sortUnits);
    if (target === "worker" && overheadMs !== undefined) this.overhead.update(overheadMs);
    const filters = spec.filters?.length ?? 0;
    if (filters > 0) {
      const n = stats.scanned / filters;
      if (n > 0) {
        const key = CostModel.filterKey(spec);
        let s = this.selectivity.get(key);
        if (!s) this.selectivity.set(key, (s = new Ewma(0.5, this.alpha)));
        s.update(stats.matched / n);
      }
    }
  }

  /** Plain snapshot for telemetry and the CSV log. */
  snapshot() {
    /** @param {CostModel["k"]["main"]} k */
    const coeffs = (k) => ({
      prep: k.prep.value,
      scan: k.scan.value,
      sort_num: k.sort.num.value,
      sort_code: k.sort.code.value,
      sort_locale: k.sort.locale.value,
    });
    return { main: coeffs(this.k.main), worker: coeffs(this.k.worker), overheadMs: this.overhead.value };
  }
}
