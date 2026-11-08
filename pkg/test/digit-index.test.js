import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeColumnar, openColumnar } from "../tablecore/columnar.js";
import { resetNarrowing, runOp } from "../tablecore/compute.js";
import { buildDigitIndex, digitMatchCodes } from "../tablecore/digit-index.js";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** SKUs in the shapes the real table has, plus the awkward ones. */
function skus() {
  const out = [];
  for (let i = 1; i <= 3000; i++) out.push(`LT-${String(i).padStart(7, "0")}`);
  for (let i = 1; i <= 3000; i += 7) out.push(`LT2-${String(i * 97).padStart(7, "0")}`);
  for (let i = 0; i < 40; i++) out.push(`SKU-${String(123456781 + i).padStart(12, "0")}`);
  for (let i = 1; i <= 1200; i++) out.push(String(i)); // unpadded: widths 1 to 4
  for (let i = 0; i < 30; i++) out.push(`-${i * 31}`); // "signed"
  out.push("123456788", "123456789", "ABC", "x-y", "LT-", "Kit 2a", "9".repeat(18));
  return out;
}

/** @param {string[]} lower @param {string} q */
const naive = (lower, q) => lower.map((s, c) => (s.includes(q) ? c : -1)).filter((c) => c >= 0);

/** @param {Uint8Array} mask */
const codesOf = (mask) => Array.from(mask.keys()).filter((c) => mask[c] === 1);

test("digit index finds exactly what includes finds", () => {
  const lower = skus().map((s) => s.toLowerCase());
  const index = buildDigitIndex(lower);
  assert.ok(index, "SKU-shaped strings get an index");
  const queries = ["", "l", "lt", "lt-", "t2-0", "-0", "-00001", "lt-0000001", "lt-0003000", "2-", "sku-0001", "x", "kit", "2a", "0", "00", "000", "1", "12", "007", "0300000", "999999999", "3000", "-3", "31", "1234567", "9999999999999999", "a-", " "];
  for (const q of queries) assert.deepEqual(codesOf(digitMatchCodes(index, lower, lower.length, q)), naive(lower, q), JSON.stringify(q));
});

test("digit index agrees with includes on random substrings", () => {
  const lower = skus().map((s) => s.toLowerCase());
  const index = buildDigitIndex(lower);
  assert.ok(index);
  let seed = 7;
  const rnd = (/** @type {number} */ n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let t = 0; t < 400; t++) {
    const s = lower[rnd(lower.length)];
    const a = rnd(s.length);
    const q = s.slice(a, a + 1 + rnd(s.length - a));
    assert.deepEqual(codesOf(digitMatchCodes(index, lower, lower.length, q)), naive(lower, q), JSON.stringify(q));
  }
});

test("digit index gives up on text that isn't codes with a number", () => {
  const names = Array.from({ length: 2000 }, (_, i) => ["cadeira gamer", "mesa", "película de vidro", "ssd"][i % 4] + (i % 3 ? " azul" : ""));
  assert.equal(buildDigitIndex(names), null);
  const manyPrefixes = Array.from({ length: 2000 }, (_, i) => `p${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0) % 26)}-${i}`);
  assert.equal(buildDigitIndex(manyPrefixes), null);
});

function skuTable() {
  const list = skus();
  // shuffled rows, so row order isn't dictionary order
  let seed = 3;
  const rows = list.map((sku, i) => ({ sku, on: i % 3 === 0 ? 0 : 1, r: (seed = (seed * 1103515245 + 12345) & 0x7fffffff) }));
  rows.sort((a, b) => a.r - b.r);
  const buf = encodeColumnar(rows.length, [
    { name: "sku", type: "dict", strings: rows.map((r) => r.sku), compare: collator.compare },
    { name: "on", type: "u8", values: rows.map((r) => r.on) },
  ]);
  return { rows, ds: openColumnar(buf) };
}

test("contains on a SKU column uses the index and matches a naive filter", () => {
  const { rows, ds } = skuTable();
  for (const q of ["LT-00012", "0", "lt2", "12", "-3"]) {
    resetNarrowing();
    const got = Array.from(runOp(ds, { filters: [{ column: "sku", op: "contains", value: q }] }).indices);
    const want = rows.map((r, i) => (r.sku.toLowerCase().includes(q.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(got, want, q);
  }
});

test("narrowing: typing, deleting and changing other filters give the same rows as a fresh run", () => {
  const { ds } = skuTable();
  /** @param {string} sku @param {boolean} [onlyActive] */
  const spec = (sku, onlyActive = false) => ({
    filters: [
      ...(sku ? [{ column: "sku", op: /** @type {const} */ ("contains"), value: sku }] : []),
      ...(onlyActive ? [{ column: "on", op: /** @type {const} */ ("eq"), value: true }] : []),
    ],
  });
  /** @type {[import("../tablecore/types.js").OpSpec, boolean][]} */
  const steps = [
    [spec("lt-0"), false],
    [spec("lt-00"), false], // the last result holds most rows: a straight pass is cheaper
    [spec("lt-0001"), false],
    [spec("lt-00012"), true],
    [spec("lt-0001"), false], // a deleted character widens
    [spec("lt-0001", true), true], // an added filter narrows
    [spec("lt-000", true), false], // not a refinement of "lt-0001"
    [spec("lt-0002", true), true],
    [spec("lt-0002"), false], // a removed filter widens
    [spec("LT-00021"), true], // case doesn't matter
    [spec("lt-00021"), true],
    [spec("lt-00021"), true], // the same spec again
    [spec("2"), false],
  ];
  for (const [s, shouldNarrow] of steps) {
    const got = runOp(ds, s);
    // what the worker does with a result: transfer it away, which detaches this buffer
    const copy = Array.from(got.indices);
    structuredClone(got.indices, { transfer: [got.indices.buffer] });
    assert.equal(got.narrowed, shouldNarrow, JSON.stringify(s));
    resetNarrowing();
    const fresh = Array.from(runOp(ds, s).indices);
    assert.deepEqual(copy, fresh, JSON.stringify(s));
    // put the narrowed run's state back, as if the fresh run never happened
    resetNarrowing();
    runOp(ds, s);
  }
});

test("no narrowing from a last result holding most rows", () => {
  const { ds } = skuTable();
  resetNarrowing();
  const wide = runOp(ds, { filters: [{ column: "sku", op: "contains", value: "lt" }] });
  assert.ok(wide.matched > ds.rows / 2);
  const next = runOp(ds, { filters: [{ column: "sku", op: "contains", value: "lt-" }] });
  assert.equal(next.narrowed, false);
  assert.equal(next.tested, ds.rows);
});

test("narrowing tests only the rows the last result kept", () => {
  const { ds } = skuTable();
  resetNarrowing();
  const wide = runOp(ds, { filters: [{ column: "sku", op: "contains", value: "lt-0001" }] });
  const narrow = runOp(ds, { filters: [{ column: "sku", op: "contains", value: "lt-00012" }] });
  assert.equal(wide.tested, ds.rows);
  assert.ok(narrow.narrowed);
  assert.equal(narrow.tested, wide.matched);
  assert.ok(narrow.matched <= wide.matched);
});
