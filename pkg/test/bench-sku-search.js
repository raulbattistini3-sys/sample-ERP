// SKU search on 600k rows shaped like the real table (LT-0000001…, LT2-0000001…): the old scan (a string
// test per distinct SKU, every keystroke), the digit index, and the index plus narrowing while typing.
//   node test/bench-sku-search.js [rows]

import { dictStrings, encodeColumnar, openColumnar } from "../tablecore/columnar.js";
import { resetNarrowing, runOp, digitIndexStats } from "../tablecore/compute.js";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const rows = Number(process.argv[2] ?? 600_000);
const half = rows / 2;
const skus = [];
for (let i = 1; i <= half; i++) skus.push(`LT-${String(i).padStart(7, "0")}`);
for (let i = 1; i <= half; i++) skus.push(`LT2-${String(i).padStart(7, "0")}`);
// rows in name order, not SKU order
for (let i = skus.length - 1; i > 0; i--) {
  const j = (i * 2654435761) % (i + 1);
  [skus[i], skus[j]] = [skus[j], skus[i]];
}
const ds = openColumnar(encodeColumnar(skus.length, [{ name: "sku", type: "dict", strings: skus, compare: collator.compare }]));
const col = /** @type {any} */ (ds.byName.get("sku"));

// the old contains: lowercased strings (warm), a memo per code, a string test per distinct value
const lower = dictStrings(col.dict).map((s) => s.toLowerCase());
/** @param {string} q */
function oldContains(q) {
  const v = col.values;
  const memo = new Uint8Array(col.dict.count);
  const out = new Uint32Array(ds.rows);
  let m = 0;
  for (let r = 0; r < ds.rows; r++) {
    const c = v[r];
    let k = memo[c];
    if (k === 0) memo[c] = k = lower[c].includes(q) ? 1 : 2;
    if (k === 1) out[m++] = r;
  }
  return out.slice(0, m);
}

/** @param {() => unknown} fn */
function time(fn, reps = 5) {
  const ms = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.floor(reps / 2)];
}

const spec = (/** @type {string} */ q) => ({ filters: [{ column: "sku", op: /** @type {const} */ ("contains"), value: q }] });
const t0 = performance.now();
runOp(ds, spec("a")); // builds the lowercased strings and the digit index
console.log(`${ds.rows} rows; first contains (builds caches) ${(performance.now() - t0).toFixed(0)} ms; index`, digitIndexStats(col.dict));

for (const typed of ["lt-0012345", "1234567", "lt2-03"]) {
  console.log(`\ntyping "${typed}"     old scan   index   index+narrowing   matches`);
  resetNarrowing();
  for (let i = 1; i <= typed.length; i++) {
    const q = typed.slice(0, i);
    const old = time(() => oldContains(q));
    const idx = time(() => {
      resetNarrowing();
      runOp(ds, spec(q));
    });
    // narrowing from the previous keystroke, as typing does
    const prev = q.slice(0, -1);
    const nar = time(() => {
      resetNarrowing();
      if (prev) runOp(ds, spec(prev));
      const t = performance.now();
      runOp(ds, spec(q));
      return performance.now() - t;
    });
    // nar timed the previous run too; time the narrowed run alone
    resetNarrowing();
    if (prev) runOp(ds, spec(prev));
    const t = performance.now();
    const r = runOp(ds, spec(q));
    const narOnly = performance.now() - t;
    const check = oldContains(q);
    if (check.length !== r.indices.length || check.some((x, j) => x !== r.indices[j])) throw new Error(`mismatch for ${q}`);
    void nar;
    console.log(`  ${q.padEnd(18)} ${old.toFixed(1).padStart(8)} ${idx.toFixed(1).padStart(7)} ${narOnly.toFixed(1).padStart(12)}${r.narrowed ? "*" : " "} ${String(r.matched).padStart(10)}`);
  }
}
console.log("\nms, median of 5; * = narrowed from the previous keystroke");
