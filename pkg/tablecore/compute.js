// The one compute function both threads run. It is pure apart from the
// per-thread string cache in columnar.js, so main-thread and worker results
// are identical and timings are comparable.

import { dictStrings, isDecoded, NULL_I32, NULL_U8 } from "./columnar.js";
import { buildTextIndex, matchCodes } from "./text-index.js";
import { buildTrigramIndex, fuzzyMatchCodes } from "./fuzzy.js";

/** @typedef {import("./types.js").Dataset} Dataset */
/** @typedef {import("./types.js").Column} Column */
/** @typedef {import("./types.js").OpSpec} OpSpec */
/** @typedef {import("./types.js").OpResult} OpResult */
/** @typedef {import("./types.js").Filter} Filter */
/** @typedef {import("./types.js").SortKey} SortKey */
/** @typedef {import("./types.js").SortClass} SortClass */

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Filters, then sorts, the first `spec.limit` rows.
 *
 * @param {Dataset} ds
 * @param {OpSpec} spec
 * @returns {OpResult}
 */
export function runOp(ds, spec) {
  const n = Math.min(spec.limit ?? ds.rows, ds.rows);
  const filters = spec.filters ?? [];
  const sort = spec.sort ?? [];

  // One-off string decoding happens here, timed apart so a cold cache doesn't
  // look like a slow device to the cost model.
  const tp = performance.now();
  let prepared = 0;
  for (const need of stringNeeds(ds, spec)) {
    if (isWarm(need)) continue;
    prepared += need.dict.count;
    if (need.kind === "lower") lowerStrings(need.dict);
    else if (need.kind === "index") textIndex(need.dict);
    else if (need.kind === "fuzzy") trigramIndex(need.dict);
    else dictStrings(need.dict);
  }
  /** @type {FilterContext} */
  const ctx = { rank: null, match: null };
  const t0 = performance.now();
  /** @type {Uint32Array} */
  let idx;
  if (filters.length === 0) {
    idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
  } else {
    idx = applyFilter(ds, filters[0], null, n, ctx);
    for (let f = 1; f < filters.length; f++) idx = applyFilter(ds, filters[f], idx, n, ctx);
  }
  const t1 = performance.now();

  let sortClass = classifySort(ds, sort);
  let keys = sort.length;
  if (sort.length > 0 && idx.length > 1) idx.sort(comparator(ds, sort));
  else if (ctx.rank && idx.length > 1) {
    // no explicit sort and a fuzzy search guessed some words: closest matches first, then row order
    const { values, score } = ctx.rank;
    idx.sort((a, b) => score[values[b]] - score[values[a]] || a - b);
    sortClass = "num";
    keys = 1;
  }
  const t2 = performance.now();

  return {
    indices: idx,
    scanned: n * filters.length,
    matched: idx.length,
    prepareMs: t0 - tp,
    prepared,
    filterMs: t1 - t0,
    sortMs: t2 - t1,
    sortUnits: sortUnits(idx.length, keys),
    sortClass,
    match: ctx.match,
  };
}

/**
 * A string cache an op depends on: `lower` for contains/eq/in filters,
 * `index` (inverted index) for token/prefix filters, `decoded` for the locale comparator.
 * `fuzzy` (a trigram index over the inverted index's terms, which it builds too) for fuzzy filters.
 * @typedef {{ key: string, kind: "lower" | "index" | "fuzzy" | "decoded", dict: import("./types.js").Dict }} StringNeed
 */

/**
 * Lists the string caches `spec` needs, so a caller can tell in advance how
 * much one-off decoding a thread will do.
 *
 * @param {Dataset} ds
 * @param {OpSpec} spec
 * @returns {StringNeed[]}
 */
export function stringNeeds(ds, spec) {
  /** @type {Map<string, StringNeed>} */
  const needs = new Map();
  for (const f of spec.filters ?? []) {
    const col = column(ds, f.column);
    if (!col.dict) continue;
    const kind = f.op === "token" || f.op === "prefix" ? "index" : f.op === "fuzzy" ? "fuzzy" : "lower";
    needs.set(`${col.name}:${kind}`, { key: `${col.name}:${kind}`, kind, dict: col.dict });
  }
  for (const k of spec.sort ?? []) {
    const col = column(ds, k.column);
    if (col.dict && (k.comparator === "locale" || !col.dict.sorted)) needs.set(`${col.name}:decoded`, { key: `${col.name}:decoded`, kind: "decoded", dict: col.dict });
  }
  return [...needs.values()];
}

/**
 * True when this thread already has the cache.
 *
 * @param {StringNeed} need
 */
export function isWarm(need) {
  if (need.kind === "lower") return lowerCache.has(need.dict.bytes);
  if (need.kind === "index") return indexCache.has(need.dict.bytes);
  if (need.kind === "fuzzy") return trigramCache.has(need.dict.bytes);
  return isDecoded(need.dict);
}

/**
 * Work units for sorting m rows by k keys: m · log2(m) · k.
 *
 * @param {number} m
 * @param {number} keys
 */
export function sortUnits(m, keys) {
  return keys === 0 || m < 2 ? 0 : m * Math.log2(m) * keys;
}

/**
 * The most expensive comparator among the keys decides the cost class.
 *
 * @param {Dataset} ds
 * @param {SortKey[]} sort
 * @returns {SortClass}
 */
export function classifySort(ds, sort) {
  /** @type {SortClass} */
  let cls = "none";
  const rank = { none: 0, num: 1, code: 2, locale: 3 };
  for (const key of sort) {
    const col = column(ds, key.column);
    /** @type {SortClass} */
    const c = col.type !== "dict" ? "num" : key.comparator === "locale" || !col.dict?.sorted ? "locale" : "code";
    if (rank[c] > rank[cls]) cls = c;
  }
  return cls;
}

/**
 * @param {Dataset} ds
 * @param {string} name
 */
function column(ds, name) {
  const col = ds.byName.get(name);
  if (!col) throw new Error(`unknown column ${name}`);
  return col;
}

/**
 * What filters leave for the rest of runOp: a fuzzy filter's per-code scores (to rank by) and how its
 * words matched (returned to the caller).
 * @typedef {{ rank: { values: Int32Array, score: Float32Array } | null, match: import("./types.js").MatchInfo | null }} FilterContext
 */

/**
 * @param {Dataset} ds
 * @param {Filter} f
 * @param {Uint32Array | null} input rows to test; null means 0..n-1
 * @param {number} n
 * @param {FilterContext} ctx
 * @returns {Uint32Array}
 */
function applyFilter(ds, f, input, n, ctx) {
  const col = column(ds, f.column);
  const test = rowTest(col, f, ctx);
  const len = input ? input.length : n;
  const out = new Uint32Array(len);
  let m = 0;
  if (input) {
    for (let i = 0; i < len; i++) {
      const r = input[i];
      if (test(r)) out[m++] = r;
    }
  } else {
    for (let r = 0; r < len; r++) if (test(r)) out[m++] = r;
  }
  // slice gives an exactly sized buffer, which is what gets transferred back.
  return out.slice(0, m);
}

/** @type {WeakMap<Uint8Array, string[]>} */
const lowerCache = new WeakMap();
/** @type {WeakMap<Uint8Array, import("./text-index.js").TextIndex>} */
const indexCache = new WeakMap();
/** @type {WeakMap<Uint8Array, import("./fuzzy.js").TrigramIndex>} */
const trigramCache = new WeakMap();

/**
 * Trigram index over a dictionary's index terms, for fuzzy filters; built once per thread.
 * @param {import("./types.js").Dict} dict
 */
function trigramIndex(dict) {
  let tri = trigramCache.get(dict.bytes);
  if (!tri) {
    tri = buildTrigramIndex(textIndex(dict));
    trigramCache.set(dict.bytes, tri);
  }
  return tri;
}

/**
 * Inverted index of a dictionary, built once per thread (like the string caches).
 * @param {import("./types.js").Dict} dict
 */
function textIndex(dict) {
  let index = indexCache.get(dict.bytes);
  if (!index) {
    index = buildTextIndex(lowerStrings(dict));
    indexCache.set(dict.bytes, index);
  }
  return index;
}

/**
 * Size and build time of a column's index on this thread, or null when it was never built.
 * @param {import("./types.js").Dict} dict
 * @returns {{ bytes: number, buildMs: number, terms: number, postings: number } | null}
 */
export function textIndexStats(dict) {
  const i = indexCache.get(dict.bytes);
  return i ? { bytes: i.bytes, buildMs: i.buildMs, terms: i.terms.length, postings: i.postings.length } : null;
}

/**
 * Size and build time of a column's trigram index on this thread, or null when it was never built.
 * @param {import("./types.js").Dict} dict
 */
export function trigramIndexStats(dict) {
  const t = trigramCache.get(dict.bytes);
  return t ? { bytes: t.bytes, buildMs: t.buildMs, trigrams: t.gramIds.size, postings: t.postings.length } : null;
}

/**
 * Lowercased dictionary, decoded once per thread like `dictStrings`.
 *
 * @param {import("./types.js").Dict} dict
 */
function lowerStrings(dict) {
  let lower = lowerCache.get(dict.bytes);
  if (!lower) {
    lower = dictStrings(dict).map((s) => s.toLowerCase());
    lowerCache.set(dict.bytes, lower);
  }
  return lower;
}

/**
 * Builds a per-row predicate. For dictionary columns the string test runs once
 * per distinct value, then rows only look up a byte.
 *
 * @param {Column} col
 * @param {Filter} f
 * @param {FilterContext} ctx
 * @returns {(row: number) => boolean}
 */
function rowTest(col, f, ctx) {
  const v = col.values;
  if (col.type === "dict") {
    if (!col.dict) throw new Error(`${col.name}: dictionary missing`);
    if (f.op === "fuzzy") {
      // per word: a word start if any term has it, else similar terms (fuzzy.js); one byte per row
      const found = fuzzyMatchCodes(textIndex(col.dict), trigramIndex(col.dict), col.dict.count, String(f.value).toLowerCase());
      ctx.match = { column: col.name, fuzzy: found.fuzzy, words: found.words };
      if (found.fuzzy) ctx.rank = { values: /** @type {Int32Array} */ (v), score: found.score };
      const mask = found.mask;
      return (r) => {
        const c = v[r];
        return c >= 0 && mask[c] === 1;
      };
    }
    if (f.op === "token" || f.op === "prefix") {
      // Index path: no string work per query, one byte lookup per row.
      const mask = matchCodes(textIndex(col.dict), col.dict.count, String(f.value).toLowerCase(), f.op);
      return (r) => {
        const c = v[r];
        return c >= 0 && mask[c] === 1;
      };
    }
    const strings = lowerStrings(col.dict);
    const set = f.op === "in" && Array.isArray(f.value) ? new Set(f.value.map((x) => String(x).toLowerCase())) : null;
    const q = String(f.value).toLowerCase();
    const eq = f.op === "eq";
    /** @type {(s: string) => boolean} */
    const hit = set ? (s) => set.has(s) : eq ? (s) => s === q : (s) => s.includes(q);
    // Memo per code (0 unknown, 1 match, 2 no match): each distinct string is
    // tested once, and only if some row in range uses it. Cost follows
    // min(rows, distinct values), not the dictionary size.
    const memo = new Uint8Array(col.dict.count);
    return (r) => {
      const c = v[r];
      if (c < 0) return false;
      let m = memo[c];
      if (m === 0) {
        const s = strings[c];
        memo[c] = m = hit(s) ? 1 : 2;
      }
      return m === 1;
    };
  }

  if (col.type === "u8") {
    const want = f.value === true || f.value === 1 || f.value === "true" ? 1 : 0;
    return (r) => v[r] !== NULL_U8 && v[r] === want;
  }

  const isNull = col.type === "i32" ? (/** @type {number} */ x) => x === NULL_I32 : Number.isNaN;
  if (f.op === "in" && Array.isArray(f.value)) {
    // any of a few numbers (a multi-select of rates); a Set of numbers, so 18 and "18" are the same
    const set = new Set(f.value.map(Number));
    return (r) => {
      const x = v[r];
      return !isNull(x) && set.has(x);
    };
  }
  const [lo, hi] =
    f.op === "between" && Array.isArray(f.value)
      ? f.value.map(Number)
      : f.op === "gte"
        ? [Number(f.value), Infinity]
        : f.op === "lte"
          ? [-Infinity, Number(f.value)]
          : [Number(f.value), Number(f.value)];
  return (r) => {
    const x = v[r];
    return !isNull(x) && x >= lo && x <= hi;
  };
}

/**
 * Multi-key comparator over typed arrays. Nulls sort last in either
 * direction; ties fall back to row order so the result is deterministic.
 *
 * @param {Dataset} ds
 * @param {SortKey[]} sort
 * @returns {(a: number, b: number) => number}
 */
function comparator(ds, sort) {
  const parts = sort.map((key) => {
    const col = column(ds, key.column);
    const dir = key.desc ? -1 : 1;
    const v = col.values;
    if (col.type === "dict") {
      if (key.comparator === "locale" || !col.dict?.sorted) {
        const s = dictStrings(/** @type {import("./types.js").Dict} */ (col.dict));
        return (/** @type {number} */ a, /** @type {number} */ b) => {
          const x = v[a];
          const y = v[b];
          if (x < 0 || y < 0) return x < 0 ? (y < 0 ? 0 : 1) : -1;
          return dir * collator.compare(s[x], s[y]);
        };
      }
      return (/** @type {number} */ a, /** @type {number} */ b) => {
        const x = v[a];
        const y = v[b];
        if (x < 0 || y < 0) return x < 0 ? (y < 0 ? 0 : 1) : -1;
        return dir * (x - y);
      };
    }
    const isNull =
      col.type === "f64" ? Number.isNaN : col.type === "i32" ? (/** @type {number} */ x) => x === NULL_I32 : (/** @type {number} */ x) => x === NULL_U8;
    return (/** @type {number} */ a, /** @type {number} */ b) => {
      const x = v[a];
      const y = v[b];
      const nx = isNull(x);
      const ny = isNull(y);
      if (nx || ny) return nx ? (ny ? 0 : 1) : -1;
      return dir * (x - y);
    };
  });

  if (parts.length === 1) {
    const only = parts[0];
    return (a, b) => only(a, b) || a - b;
  }
  return (a, b) => {
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i](a, b);
      if (c !== 0) return c;
    }
    return a - b;
  };
}
