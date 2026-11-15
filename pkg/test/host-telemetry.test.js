import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHostTelemetry, Distribution, parseServerTiming, sampleCategory } from "../telemetry/host.js";

/** @typedef {import("../telemetry/host.js").HostTelemetryEnvelope} HostTelemetryEnvelope */

test("envelopes carry bootId, consecutive sequences and samples of the three categories", async () => {
  /** @type {HostTelemetryEnvelope[]} */
  const sent = [];
  const t = createHostTelemetry({ source: "test-api", instanceId: "api-01", send: async (e) => void sent.push(e) });
  t.start();
  t.ready();
  t.recordRequest({ method: "GET", route: "/clientes", status: 200, ms: 12, timings: { db: 5 } });
  t.recordRequest({ method: "GET", route: "/clientes", status: 200, ms: 20, timings: { db: 7 } });
  await t.query("clientes.list", async () => 1);
  await t.flush();
  await t.stop();

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((e) => e.sequence), [0, 1]);
  assert.equal(sent[0].bootId, sent[1].bootId);
  for (const e of sent) {
    assert.equal(e.version, 1);
    assert.equal(e.instanceId, "api-01");
    assert.ok(!Number.isNaN(Date.parse(e.timestamp)));
  }

  const first = sent[0].samples;
  const lifecycle = first.filter((s) => s.type === "lifecycle").map((s) => s.state);
  assert.deepEqual(lifecycle, ["started", "ready"]);
  const req = /** @type {Record<string, unknown>} */ (first.find((s) => s.type === "http.request"));
  assert.equal(req.count, 2);
  assert.equal(req.status, "2xx");
  assert.deepEqual(req.timings, { db: 6 });
  assert.ok(first.some((s) => s.type === "db.query"));
  assert.ok(first.some((s) => s.type === "process.memory"));
  assert.deepEqual(new Set(first.map(sampleCategory)), new Set(["lifecycle", "runtime", "performance"]));
  assert.ok(sent[1].samples.some((s) => s.type === "lifecycle" && s.state === "stopping"));
});

test("a failed send keeps the envelope and retries it before the next one, in order", async () => {
  /** @type {number[]} */
  const seen = [];
  let fail = true;
  const t = createHostTelemetry({
    source: "test-api",
    send: async (e) => {
      if (fail) throw new Error("down");
      seen.push(e.sequence);
    },
  });
  await t.flush();
  assert.equal(t.queued, 1);
  fail = false;
  await t.flush();
  assert.deepEqual(seen, [0, 1]);
  assert.equal(t.queued, 0);
});

test("the middleware sends Server-Timing with app and the parts measured inside the request", async () => {
  const t = createHostTelemetry({ source: "test-api", send: async () => {} });
  const mw = t.middleware({ timingAllowOrigin: "http://localhost:5173", routeOf: () => "/x" });
  const server = createServer((req, res) =>
    mw(req, res, async () => {
      await t.query("q", () => new Promise((r) => setTimeout(r, 5)));
      res.end("ok");
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const res = await fetch(`http://127.0.0.1:${port}/x`);
  await res.text();
  server.close();
  const timing = parseServerTiming(res.headers.get("server-timing"));
  assert.ok(timing.app >= timing.db, JSON.stringify(timing));
  assert.ok(timing.db >= 4);
  assert.equal(res.headers.get("timing-allow-origin"), "http://localhost:5173");
  await new Promise((r) => setTimeout(r, 10));
  const req = /** @type {Record<string, unknown>} */ (t.collect().find((s) => s.type === "http.request"));
  assert.equal(req.route, "/x");
});

test("Distribution percentiles", () => {
  const d = new Distribution();
  for (let i = 1; i <= 100; i++) d.add(i);
  const s = d.summary();
  assert.equal(s.p50Ms, 50);
  assert.equal(s.p99Ms, 99);
  assert.equal(s.maxMs, 100);
  assert.equal(s.meanMs, 50.5);
});
