import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createIngestChild } from "../telemetry/ingest-child.js";
import { createHostTelemetry } from "../telemetry/host.js";

const fake = fileURLToPath(new URL("./fixtures/fake-ingest.js", import.meta.url));

/** @param {() => boolean} cond */
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** @param {number} sequence */
const envelope = (sequence) => ({ version: /** @type {1} */ (1), source: "test-api", instanceId: "api-01", bootId: "b1", sequence, timestamp: new Date().toISOString(), samples: [{ type: "x" }] });

test("envelopes go over IPC and are acked; resends come back duplicate; bad ones are dropped, not retried", async () => {
  const child = createIngestChild({ exe: process.execPath, args: [fake], env: { WIN_TELEMETRY_JOB: "Local\\test-job" } });
  await assert.rejects(child.send(envelope(0)), /not ready/);
  await until(() => child.ready);

  assert.deepEqual(await child.send(envelope(0)), { duplicate: false, samples: 1, rejected: false });
  assert.deepEqual(await child.send(envelope(1)), { duplicate: false, samples: 1, rejected: false });
  assert.equal((await child.send(envelope(0))).duplicate, true);
  assert.equal((await child.send(envelope(99))).rejected, true);
  await assert.rejects(child.send(envelope(98)), /connection reset/);
  assert.equal((await child.send(envelope(98))).duplicate, false);

  assert.deepEqual({ ...child.stats, jobReadings: 0 }, { starts: 1, acked: 3, duplicates: 1, rejected: 1, failed: 1, jobReadings: 0 });
  await child.stop();
  assert.equal(child.ready, false);
});

test("the job readings from the child: the limit for the service, the samples once into its envelopes", async () => {
  const child = createIngestChild({ exe: process.execPath, args: [fake], env: { WIN_TELEMETRY_JOB: "Local\\test-job" } });
  await until(() => child.job() !== null);
  const job = child.job();
  assert.equal(job?.processMemoryLimitBytes, 512 * 1024 * 1024);
  assert.equal(job?.peakProcessMemoryBytes, 200 * 1024 * 1024);
  assert.equal(job?.jobMemoryLimitBytes, null);
  assert.equal(job?.samples[0].jobName, "Local\\test-job"); // the child inherited the job's name

  /** @type {import("../telemetry/host.js").HostTelemetryEnvelope[]} */
  const sent = [];
  const t = createHostTelemetry({
    source: "test-api",
    instanceId: "api-01",
    extraSamples: child.extraSamples,
    send: async (e) => {
      await child.send(e);
      sent.push(e);
    },
  });
  t.start();
  await t.flush();
  await t.flush(); // nothing new in between, or only the latest reading
  await t.stop();
  const types = sent[0].samples.map((s) => s.type);
  assert.ok(types.includes("win.job") && types.includes("win.system"), types.join());
  assert.equal(sent[0].samples.filter((s) => s.type === "win.job").length, 1);
  assert.ok(child.stats.acked >= 2);
  await child.stop();
});

test("a child that dies is restarted; until then sends fail fast so the caller can fall back", async () => {
  /** @type {string[]} */
  const logs = [];
  const child = createIngestChild({ exe: process.execPath, args: [fake], env: { FAKE_INGEST_CRASH: "1" }, log: (m) => logs.push(m) });
  await until(() => child.stats.starts >= 2, 8000);
  assert.ok(logs.some((l) => /exited \(3\), restarting in 1s/.test(l)), logs.join("\n"));
  await child.stop();
  const starts = child.stats.starts;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(child.stats.starts, starts); // stopped means stopped
  await assert.rejects(child.send(envelope(5)), /not ready/);
});
