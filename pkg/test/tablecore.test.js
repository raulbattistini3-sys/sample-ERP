import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeColumnar, openColumnar, dictString, NULL_I32 } from "../tablecore/columnar.js";
import { runOp } from "../tablecore/compute.js";
import { CostModel, Ewma } from "../tablecore/cost-model.js";
import { createScheduler } from "../tablecore/scheduler.js";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Deterministic pseudo-random rows, with nulls. */
function fixture(n = 5000) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words = ["Cadeira", "Mesa", "Película", "SSD", "Smartphone", "Água", "abacate", "Zebra"];
  const rows = Array.from({ length: n }, (_, i) => ({
    name: rnd() < 0.02 ? null : `${words[Math.floor(rnd() * words.length)]} ${Math.floor(rnd() * 500)}`,
    price: rnd() < 0.02 ? NaN : Math.round(rnd() * 100000) / 100,
    qty: rnd() < 0.02 ? NULL_I32 : Math.floor(rnd() * 100),
    on: rnd() < 0.5 ? 1 : 0,
    i,
  }));
  const buf = encodeColumnar(n, [
    { name: "name", type: "dict", strings: rows.map((r) => r.name), compare: collator.compare },
    { name: "price", type: "f64", values: rows.map((r) => r.price) },
    { name: "qty", type: "i32", values: rows.map((r) => r.qty) },
    { name: "on", type: "u8", values: rows.map((r) => r.on) },
  ]);
  return { rows, ds: openColumnar(buf) };
}

test("columnar round-trips every type", () => {
  const { rows, ds } = fixture(300);
  assert.equal(ds.rows, 300);
  const name = /** @type {any} */ (ds.byName.get("name"));
  for (const r of rows) {
    assert.equal(dictString(name.dict, name.values[r.i]), r.name);
    const p = ds.byName.get("price")?.values[r.i];
    assert.ok(Number.isNaN(r.price) ? Number.isNaN(p) : p === r.price);
    assert.equal(ds.byName.get("qty")?.values[r.i], r.qty);
  }
});

test("in filter matches any listed value, case-insensitively", () => {
  const { rows, ds } = fixture(3000);
  const got = Array.from(runOp(ds, { filters: [{ column: "name", op: "in", value: ["ssd 10", "MESA 20"] }] }).indices);
  const want = rows.filter((r) => r.name !== null && ["ssd 10", "mesa 20"].includes(r.name.toLowerCase())).map((r) => r.i);
  assert.ok(want.length > 0);
  assert.deepEqual(got, want);
});

test("token and prefix filters match a naive word implementation", () => {
  const { rows, ds } = fixture(4000);
  const words = (/** @type {string} */ s) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  /** @param {string} q @param {(w: string, q: string) => boolean} hit */
  const naive = (q, hit) =>
    rows.filter((r) => r.name !== null && words(q).every((qw) => words(/** @type {string} */ (r.name)).some((w) => hit(w, qw)))).map((r) => r.i);
  for (const q of ["mesa", "MESA 1", "água", "s", "zz"]) {
    const tok = Array.from(runOp(ds, { filters: [{ column: "name", op: "token", value: q }] }).indices);
    const pre = Array.from(runOp(ds, { filters: [{ column: "name", op: "prefix", value: q }] }).indices);
    assert.deepEqual(tok, naive(q, (w, qw) => w === qw), `token ${q}`);
    assert.deepEqual(pre, naive(q, (w, qw) => w.startsWith(qw)), `prefix ${q}`);
  }
});

test("sorted dictionary: code order equals pt-BR collation", () => {
  const { ds } = fixture(2000);
  const d = /** @type {any} */ (ds.byName.get("name")).dict;
  for (let c = 1; c < d.count; c++) assert.ok(collator.compare(dictString(d, c - 1) ?? "", dictString(d, c) ?? "") <= 0);
});

test("runOp matches a naive Array implementation", () => {
  const { rows, ds } = fixture();
  const spec = {
    limit: 4000,
    filters: [/** @type {const} */ ({ column: "name", op: "contains", value: "a" }), /** @type {const} */ ({ column: "price", op: "gte", value: 100 })],
    sort: [{ column: "qty", desc: true }, { column: "name" }],
  };
  const got = Array.from(runOp(ds, spec).indices);

  const expected = rows
    .slice(0, 4000)
    .filter((r) => r.name !== null && r.name.toLowerCase().includes("a") && !Number.isNaN(r.price) && r.price >= 100)
    .sort((a, b) => {
      const an = a.qty === NULL_I32;
      const bn = b.qty === NULL_I32;
      if (an !== bn) return an ? 1 : -1;
      return (an ? 0 : b.qty - a.qty) || collator.compare(/** @type {string} */ (a.name), /** @type {string} */ (b.name)) || a.i - b.i;
    })
    .map((r) => r.i);
  assert.deepEqual(got, expected);
});

test("code comparator and locale comparator agree", () => {
  const { ds } = fixture();
  const a = runOp(ds, { sort: [{ column: "name", comparator: "auto" }] });
  const b = runOp(ds, { sort: [{ column: "name", comparator: "locale" }] });
  assert.equal(a.sortClass, "code");
  assert.equal(b.sortClass, "locale");
  // Equal-collating strings may tie differently, so compare the strings, not the rows.
  const d = /** @type {any} */ (ds.byName.get("name"));
  const names = (/** @type {Uint32Array} */ idx) => Array.from(idx, (r) => dictString(d.dict, d.values[r]));
  assert.deepEqual(names(a.indices), names(b.indices));
});

test("Ewma averages early samples, then weights by alpha", () => {
  const e = new Ewma(100, 0.25);
  e.update(10);
  assert.equal(e.value, 10);
  e.update(20);
  assert.equal(e.value, 15);
  e.update(15);
  e.update(15);
  e.update(55);
  assert.equal(e.value, 25);
});

test("cost model learns k from observations", () => {
  const { ds } = fixture();
  const m = new CostModel();
  const spec = { sort: [{ column: "price" }] };
  const est = m.estimate(ds, spec);
  for (let i = 0; i < 5; i++) {
    m.observe("main", spec, { scanned: 0, matched: est.n, prepareMs: 0, prepared: 0, filterMs: 0, sortMs: est.sortUnits * 1e-4, sortUnits: est.sortUnits, sortClass: "num" });
  }
  assert.ok(Math.abs(m.predict("main", est) - est.sortUnits * 1e-4) < 1e-9);
});

test("adaptive: main within budget, worker over it, main always without a worker", () => {
  const { ds } = fixture();
  const model = new CostModel();
  const fakeWorker = /** @type {any} */ ({});
  const s = createScheduler({ dataset: ds, worker: fakeWorker, model, epsilon: 0, budgetMs: 50 });
  const spec = { sort: [{ column: "price" }] };
  const est = model.estimate(ds, spec);

  model.k.main.sort.num.value = 1 / est.sortUnits; // 1 ms
  assert.equal(s.decide(spec).target, "main");
  model.k.main.sort.num.value = 500 / est.sortUnits; // 500 ms
  assert.equal(s.decide(spec).target, "worker");

  const noWorker = createScheduler({ dataset: ds, worker: null, model, epsilon: 0 });
  assert.equal(noWorker.decide(spec).reason, "no-worker");
});

test("adaptive: a busy main thread shrinks the budget", () => {
  const { ds } = fixture();
  const model = new CostModel();
  const spec = { sort: [{ column: "price" }] };
  const est = model.estimate(ds, spec);
  model.k.main.sort.num.value = 30 / est.sortUnits; // 30 ms
  const busy = /** @type {any} */ ({ mainBusy: () => 0.6, pressure: () => "nominal", markSelf() {} });
  const idle = /** @type {any} */ ({ mainBusy: () => 0, pressure: () => "nominal", markSelf() {} });
  const opts = { dataset: ds, worker: /** @type {any} */ ({}), model, epsilon: 0, budgetMs: 50 };
  assert.equal(createScheduler({ ...opts, signals: idle }).decide(spec).target, "main");
  assert.equal(createScheduler({ ...opts, signals: busy }).decide(spec).target, "worker"); // budget 20 ms
});

test("exploration never sends a huge op to main", () => {
  const { ds } = fixture();
  const model = new CostModel();
  const spec = { sort: [{ column: "price" }] };
  model.k.main.sort.num.value = 1000 / model.estimate(ds, spec).sortUnits;
  const s = createScheduler({ dataset: ds, worker: /** @type {any} */ ({}), model, epsilon: 1, random: () => 0 });
  assert.equal(s.decide(spec).target, "worker");
});

test("works over a SharedArrayBuffer (TextDecoder rejects shared views)", async () => {
  const { toShared } = await import("../tablecore/columnar.js");
  const { rows, ds } = fixture(500);
  const shared = toShared(ds);
  assert.ok(shared.buffer instanceof SharedArrayBuffer);
  const name = /** @type {any} */ (shared.byName.get("name"));
  assert.equal(dictString(name.dict, name.values[3]), rows[3].name);
  const r = runOp(shared, { filters: [{ column: "name", op: "contains", value: "a" }], sort: [{ column: "name", comparator: "locale" }] });
  assert.ok(r.matched > 0);
});

test("numeric `in` keeps rows whose value is one of the listed numbers", () => {
  const { rows, ds } = fixture(2000);
  const r = runOp(ds, { filters: [{ column: "qty", op: "in", value: [3, 7, 42] }] });
  const want = rows.filter((x) => x.qty === 3 || x.qty === 7 || x.qty === 42).map((x) => x.i);
  assert.deepEqual([...r.indices], want);
});

test("coldFor: a search bound for a worker that hasn't built its index yet is cold, until the worker has", async () => {
  const { ds } = fixture(60_000);
  /** @type {any} */
  const fakeWorker = {
    run: async (/** @type {any} */ spec) => {
      const { indices, ...stats } = runOp(ds, spec);
      return { stale: false, id: 1, indices, stats, timing: { totalMs: 1, postMs: 0, toWorkerMs: 0, replyMs: 0, queuedBehind: 0 } };
    },
  };
  const s = createScheduler({ dataset: ds, worker: fakeWorker, strategy: "worker", epsilon: 0 });
  const spec = { filters: [{ column: "name", op: /** @type {const} */ ("prefix"), value: "mesa" }] };
  assert.equal(s.coldFor(spec), true);
  await s.run(spec);
  assert.equal(s.coldFor(spec), false, "warm once the worker has run it");
  // numbers need no string cache: never cold
  assert.equal(s.coldFor({ filters: [{ column: "price", op: "gte", value: 10 }] }), false);
  // pinned to the main thread: never waits on the worker
  assert.equal(s.coldFor({ filters: [{ column: "name", op: "contains", value: "x" }] }, "main"), false);
  // no worker at all: nothing to wait on
  assert.equal(createScheduler({ dataset: ds, worker: null }).coldFor(spec), false);
});
