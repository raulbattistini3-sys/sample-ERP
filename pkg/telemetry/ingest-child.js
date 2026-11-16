// @ts-check
// The service end of TCC's IPC ingest protocol ("tcc-ingest/1", tcc-v1 apps/server/src/lib/ingest-ipc.ts).
//
// Instead of POSTing its host telemetry to the TCC server (and the server re-checking each record), the
// service starts tcc-v2.exe with TCC_MODE=ingest-ipc as its own child, with an "ipc" stdio slot, and
// hands it the envelopes as messages; the child stores them in the TCC database and acks each one. No
// HTTP request in either direction.
//
// Because the child is the service's child, it sits in the service's job object (the launcher's memory
// limit; WIN_TELEMETRY_JOB names it, inherited through the environment) and sends the job's readings
// back every second: win.job (memory limit, peak, processes, CPU, I/O) and win.system. Those readings
// go into the service's own envelopes (`extraSamples`) and are there for the service to adapt to
// (`job()`: the limit and how close the process is to it).
//
//   service → child  { kind: "envelope", id, envelope }
//   child → service  { kind: "ready", protocol, pid, job } | { kind: "ack", id, duplicate, samples }
//                    { kind: "nack", id, error, retry }     | { kind: "job", at, samples }

import { spawn as nodeSpawn } from "node:child_process";

export const IPC_PROTOCOL = "tcc-ingest/1";

/** @typedef {import("./host.js").HostTelemetryEnvelope} HostTelemetryEnvelope */
/** @typedef {import("./host.js").TelemetrySample} TelemetrySample */

/**
 * @typedef {object} IngestChildOptions
 * @property {string} exe tcc-v2.exe (TCC_INGEST_EXE)
 * @property {string[]} [args] before the mode (TCC_INGEST_ARGS: a script, when exe is node/bun)
 * @property {Record<string, string | undefined>} [env] added to this process's environment; TCC_MODE is set here
 * @property {number} [ackTimeoutMs] an envelope not acked by then is failed and retried by host telemetry (default 10 s)
 * @property {number} [readyTimeoutMs] a child that hasn't said ready by then is restarted (default 15 s)
 * @property {number} [maxBackoffMs] restart delay cap after the child exits (default 30 s; starts at 1 s)
 * @property {(message: string) => void} [log]
 * @property {typeof nodeSpawn} [spawn] tests
 */

/**
 * @typedef {object} JobView
 * @property {string} at when the child read it
 * @property {TelemetrySample[]} samples win.job / win.system as the child read them
 * @property {number | null} processMemoryLimitBytes the per-process commit limit of the job, if any
 * @property {number | null} jobMemoryLimitBytes the whole job's limit, if any
 * @property {number | null} peakProcessMemoryBytes the largest commit a process of the job has reached
 */

/**
 * Starts (and restarts) the telemetry child. `send` delivers one envelope over IPC and resolves on its
 * ack; it rejects while the child isn't ready (the caller falls back or keeps it queued), on a retryable
 * nack and on timeout. A nack with retry: false (an envelope TCC will never accept) resolves with
 * `rejected: true`, so the queue moves on.
 * @param {IngestChildOptions} opts
 */
export function createIngestChild(opts) {
  const spawn = opts.spawn ?? nodeSpawn;
  const ackTimeoutMs = opts.ackTimeoutMs ?? 10_000;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 15_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const log = opts.log ?? (() => {});

  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let ready = false;
  let stopped = false;
  let backoff = 1000;
  let nextId = 1;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let restartTimer = null;
  /** @type {Map<number, { resolve: (r: { duplicate: boolean, samples: number, rejected: boolean }) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
  const inflight = new Map();
  /** @type {JobView | null} */
  let latestJob = null;
  /** @type {TelemetrySample[] | null} */
  let unreported = null;
  const stats = { starts: 0, acked: 0, duplicates: 0, rejected: 0, failed: 0, jobReadings: 0 };

  /** @param {string} why */
  function failAll(why) {
    for (const [id, p] of inflight) {
      clearTimeout(p.timer);
      inflight.delete(id);
      stats.failed++;
      p.reject(new Error(why));
    }
  }

  function start() {
    if (stopped) return;
    stats.starts++;
    ready = false;
    /** @type {import("node:child_process").ChildProcess} */
    let c;
    try {
      c = spawn(opts.exe, [...(opts.args ?? [])], {
        env: { ...process.env, ...opts.env, TCC_MODE: "ingest-ipc" },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        windowsHide: true,
      });
    } catch (err) {
      log(`telemetry child not started: ${/** @type {Error} */ (err).message}`);
      scheduleRestart();
      return;
    }
    child = c;
    const readyTimer = setTimeout(() => {
      if (child === c && !ready) {
        log(`telemetry child silent for ${readyTimeoutMs} ms, restarting`);
        c.kill();
      }
    }, readyTimeoutMs);
    readyTimer.unref?.();

    c.on("message", (/** @type {any} */ m) => {
      if (!m || typeof m !== "object") return;
      if (m.kind === "ready") {
        clearTimeout(readyTimer);
        if (m.protocol !== IPC_PROTOCOL) {
          log(`telemetry child speaks ${m.protocol}, expected ${IPC_PROTOCOL}; not using it`);
          c.kill();
          return;
        }
        ready = true;
        backoff = 1000;
        log(`telemetry child ready (pid ${m.pid}${m.job ? ", job readings" : ""})`);
      } else if (m.kind === "ack" || m.kind === "nack") {
        const p = inflight.get(m.id);
        if (!p) return;
        inflight.delete(m.id);
        clearTimeout(p.timer);
        if (m.kind === "ack") {
          if (m.duplicate) stats.duplicates++;
          else stats.acked++;
          p.resolve({ duplicate: !!m.duplicate, samples: Number(m.samples) || 0, rejected: false });
        } else if (m.retry === false) {
          stats.rejected++;
          log(`telemetry envelope rejected: ${m.error}`);
          p.resolve({ duplicate: false, samples: 0, rejected: true });
        } else {
          stats.failed++;
          p.reject(new Error(`telemetry child: ${m.error}`));
        }
      } else if (m.kind === "job" && Array.isArray(m.samples)) {
        stats.jobReadings++;
        latestJob = view(m.at, m.samples);
        unreported = m.samples;
      }
    });
    c.on("error", (err) => log(`telemetry child: ${err.message}`));
    c.on("exit", (code, signal) => {
      clearTimeout(readyTimer);
      if (child !== c) return;
      child = null;
      ready = false;
      failAll("telemetry child exited");
      if (stopped) return;
      log(`telemetry child exited (${signal ?? code}), restarting in ${backoff / 1000}s`);
      scheduleRestart();
    });
  }

  function scheduleRestart() {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, backoff);
    restartTimer.unref?.();
    backoff = Math.min(backoff * 2, maxBackoffMs);
  }

  /**
   * @param {HostTelemetryEnvelope} envelope
   * @returns {Promise<{ duplicate: boolean, samples: number, rejected: boolean }>}
   */
  function send(envelope) {
    const c = child;
    if (!c || !ready || !c.connected) return Promise.reject(new Error("telemetry child not ready"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (inflight.delete(id)) {
          stats.failed++;
          reject(new Error(`telemetry child: no ack in ${ackTimeoutMs} ms`));
        }
      }, ackTimeoutMs);
      timer.unref?.();
      inflight.set(id, { resolve, reject, timer });
      c.send({ kind: "envelope", id, envelope }, (err) => {
        if (!err) return;
        const p = inflight.get(id);
        if (!p) return;
        inflight.delete(id);
        clearTimeout(p.timer);
        stats.failed++;
        p.reject(err);
      });
    });
  }

  /**
   * The job readings received since the last call, for the next host telemetry envelope (each reading
   * goes out once; between envelopes only the latest is kept).
   * @returns {TelemetrySample[]}
   */
  function extraSamples() {
    const out = unreported ?? [];
    unreported = null;
    return out;
  }

  /** disconnects; the child stores what it has and exits on its own */
  async function stop() {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const c = child;
    if (!c) return;
    // what's in flight still gets its ack, briefly
    const deadline = Date.now() + 2000;
    while (inflight.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    failAll("telemetry stopped");
    const exited = new Promise((r) => c.once("exit", r));
    if (c.connected) c.disconnect();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (c.exitCode === null && c.signalCode === null) c.kill();
    child = null;
  }

  start();
  return {
    send,
    extraSamples,
    stop,
    stats,
    /** whether envelopes go over IPC right now */
    get ready() {
      return ready && !!child?.connected;
    },
    /** the latest reading of the job the service runs in, or null before the first */
    job: () => latestJob,
  };
}

/**
 * @param {string} at
 * @param {TelemetrySample[]} samples
 * @returns {JobView}
 */
function view(at, samples) {
  /** @type {Record<string, unknown>} */
  const job = samples.find((s) => s.type === "win.job") ?? {};
  /** @param {unknown} v */
  const num = (v) => (typeof v === "number" && v > 0 ? v : null);
  return {
    at,
    samples,
    processMemoryLimitBytes: num(job.processMemoryLimitBytes),
    jobMemoryLimitBytes: num(job.jobMemoryLimitBytes),
    peakProcessMemoryBytes: num(job.peakProcessMemoryBytes),
  };
}
