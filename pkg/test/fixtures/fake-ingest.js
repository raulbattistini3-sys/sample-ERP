// A stand-in for tcc-v2.exe in TCC_MODE=ingest-ipc (tcc-v1 apps/server/src/lib/ingest-ipc.ts), for
// test/ingest-child.test.js. Acks each envelope (a resent sequence as duplicate), nacks sequence 99 for
// good (a bad envelope) and sequence 98 once (a database hiccup), reports a 512 MB job, exits on disconnect.
// FAKE_INGEST_CRASH=1: exits right after ready, to exercise the restart.

if (!process.send) throw new Error("needs an IPC channel");
if (process.env.TCC_MODE !== "ingest-ipc") throw new Error(`TCC_MODE=${process.env.TCC_MODE}`);

const seen = new Set();
let hiccup = true;
// a send racing the service's disconnect is dropped (the real child does the same)
const send = (m) => process.connected && process.send(m, () => {});

process.on("message", (m) => {
  if (m?.kind !== "envelope") return;
  const { id, envelope } = m;
  if (envelope.sequence === 99) return send({ kind: "nack", id, error: "bad schema: samples", retry: false });
  if (envelope.sequence === 98 && hiccup) {
    hiccup = false;
    return send({ kind: "nack", id, error: "connection reset", retry: true });
  }
  const key = `${envelope.bootId}/${envelope.sequence}`;
  const duplicate = seen.has(key);
  seen.add(key);
  send({ kind: "ack", id, duplicate, samples: envelope.samples.length });
});
process.on("disconnect", () => process.exit(0));

send({ kind: "ready", protocol: "tcc-ingest/1", pid: process.pid, job: true });
const job = () =>
  send({
    kind: "job",
    at: new Date().toISOString(),
    samples: [
      { type: "win.job", category: "runtime", jobName: process.env.WIN_TELEMETRY_JOB ?? null, processMemoryLimitBytes: 512 * 1024 * 1024, peakProcessMemoryBytes: 200 * 1024 * 1024, activeProcesses: 2 },
      { type: "win.system", category: "runtime", memoryLoadPercent: 61 },
    ],
  });
job();
setInterval(job, 50);
if (process.env.FAKE_INGEST_CRASH === "1") setTimeout(() => process.exit(3), 20);
