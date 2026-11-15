// What a Node service measures about itself, batched into HostTelemetryEnvelopes. Node only (perf_hooks,
// async_hooks), so it is its own entry point and not re-exported from index.js, which the web bundles.
// Ported from tcc-v1's @tcc/host-telemetry; the envelope and sample shapes are the ones its contracts
// package validates, written here as JSDoc so this package keeps no dependencies.
//
//   const telemetry = createHostTelemetry({ source: "sample-erp-api", instanceId: "api-01", send: httpSender(url, token) });
//   app.use(telemetry.middleware({ timingAllowOrigin: "http://localhost:5173" }));
//   const rows = await telemetry.query("clientes.list", () => db.select().from(clientes));
//   telemetry.start();
//   telemetry.ready();
//
// Three categories:
// - runtime: process.memory (RSS, heap, external) every interval; gc (count, pause time by kind) from
//   a PerformanceObserver, so a heap spike can be lined up with the pauses it caused;
// - performance: event-loop.delay as a histogram (monitorEventLoopDelay: p50/p95/p99, not a single
//   reading), event-loop.utilization, http.request and db.query aggregated per route / query name;
// - lifecycle: started, ready, degraded / recovered (event-loop p99 over a threshold), stopping.
//   "restarted" is the server's conclusion from a new bootId, not something a process can say.
//
// Envelope fields:
// - bootId: one per process start. A new bootId for the same instanceId is a restart.
// - sequence: 0, 1, 2... within a boot. A gap is a lost batch; the same number twice is a retry.
// - timestamp: wall clock (ISO), only to correlate with other sources. Every duration comes from
//   performance.now() or a perf_hooks histogram (monotonic), never by subtracting two timestamps.
//
// Volume: requests and queries are aggregated per interval (count, mean, p50/p95/p99, max), one sample
// per route and status class, never one per request. Query names are labels ("clientes.list"), never
// SQL text: these samples are training data and must not carry what users searched for.

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";
import { constants, monitorEventLoopDelay, performance, PerformanceObserver } from "node:perf_hooks";
import { join } from "node:path";
import v8 from "node:v8";

/** @typedef {import("node:http").IncomingMessage} IncomingMessage */
/** @typedef {import("node:http").ServerResponse} ServerResponse */

/** @typedef {"runtime" | "performance" | "lifecycle" | "other"} SampleCategory */
/** @typedef {"started" | "ready" | "degraded" | "recovered" | "stopping"} LifecycleState */

/**
 * One measurement over the interval since the previous envelope (`intervalMs`). The known types are
 * process.memory, gc, event-loop.delay, event-loop.utilization, http.request, db.query and lifecycle;
 * any other `type` may say its own `category`.
 * @typedef {{ type: string, category?: SampleCategory } & Record<string, unknown>} TelemetrySample
 */

/**
 * @typedef {object} HostTelemetryEnvelope
 * @property {1} version
 * @property {string} source the service: "sample-erp-api"
 * @property {string} instanceId the replica: "api-01"
 * @property {string} bootId
 * @property {number} sequence
 * @property {string} timestamp
 * @property {TelemetrySample[]} samples
 */

/**
 * @typedef {object} HostTelemetryOptions
 * @property {string} source the service, e.g. "sample-erp-api"
 * @property {string} [instanceId] the replica, e.g. "api-01" (default: the host name)
 * @property {(envelope: HostTelemetryEnvelope) => Promise<void>} send delivers one envelope; a rejection keeps it queued and retries it, in order, on the next tick
 * @property {number} [intervalMs] how often samples are taken and a batch is sent (default 10 s)
 * @property {number} [maxQueue] envelopes kept while `send` fails; the oldest go first and leave a gap in `sequence` (default 360: 1 h at 10 s)
 * @property {number} [loopResolutionMs] monitorEventLoopDelay's sampling resolution (default 10 ms)
 * @property {number} [degradedLoopP99Ms] event-loop p99 above this marks the service degraded, below it again recovered (default 200 ms; 0 disables)
 * @property {number} [maxSeries] distinct request routes / query names kept per interval; the rest are counted under "(other)" (default 200)
 * @property {number} [heapEvery] a process.heap sample (V8 heap per space) every Nth interval (default 6: once a minute at 10 s; 0 disables)
 * @property {(err: unknown) => void} [onError]
 */

/**
 * @typedef {object} RequestRecord
 * @property {string} method
 * @property {string} route
 * @property {number} status
 * @property {number} ms
 * @property {Record<string, number>} [timings] Server-Timing parts measured inside the request, summed by name: { db: 7.2 }
 */

/**
 * @typedef {object} MiddlewareOptions
 * @property {(req: IncomingMessage) => string} [routeOf] the route a request is counted under (default: Express's matched route, else "unmatched"; never the raw URL)
 * @property {string | string[]} [timingAllowOrigin] sends Timing-Allow-Origin, so a page on these origins sees the detailed resource timing (and Server-Timing) of these responses
 * @property {boolean} [serverTiming] adds Server-Timing to responses (default true)
 */

/** @type {Record<string, SampleCategory>} */
const CATEGORY_OF = {
  "process.memory": "runtime",
  "process.heap": "runtime",
  gc: "runtime",
  cache: "performance",
  "event-loop.delay": "performance",
  "event-loop.utilization": "performance",
  "http.request": "performance",
  "db.query": "performance",
  lifecycle: "lifecycle",
};
/** @type {readonly SampleCategory[]} */
export const SAMPLE_CATEGORIES = ["runtime", "performance", "lifecycle", "other"];

/**
 * runtime, performance or lifecycle; a sample may say its own (`category`) when its type is unknown.
 * @param {{ type: string, category?: unknown }} s
 * @returns {SampleCategory}
 */
export function sampleCategory(s) {
  const known = CATEGORY_OF[s.type];
  if (known) return known;
  return SAMPLE_CATEGORIES.includes(/** @type {SampleCategory} */ (s.category)) ? /** @type {SampleCategory} */ (s.category) : "other";
}

// ─── distributions ──────────────────────────────────────────────────────────────────────────────────

const RESERVOIR = 1024;

/** @param {number} v */
const round = (v) => Math.round(v * 1000) / 1000;
/** @param {number} ns */
const nsToMs = (ns) => round(ns / 1e6);

/** count, sum and max exact; percentiles from a uniform reservoir of at most 1024 values. */
export class Distribution {
  count = 0;
  sum = 0;
  max = 0;
  /** @type {number[]} */
  #values = [];

  /** @param {number} v */
  add(v) {
    this.count++;
    this.sum += v;
    if (v > this.max) this.max = v;
    if (this.#values.length < RESERVOIR) this.#values.push(v);
    else {
      const i = Math.floor(Math.random() * this.count);
      if (i < RESERVOIR) this.#values[i] = v;
    }
  }

  summary() {
    const sorted = [...this.#values].sort((a, b) => a - b);
    /** @param {number} p */
    const q = (p) => round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0);
    return { count: this.count, meanMs: round(this.count ? this.sum / this.count : 0), p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: round(this.max), sumMs: round(this.sum) };
  }
}

const OTHER = "(other)";

/**
 * V8's heap per space ("new_space" → "new"), plus the totals that are not in process.memoryUsage()
 * @returns {TelemetrySample}
 */
export function heapSample() {
  const h = v8.getHeapStatistics();
  /** @type {Record<string, { usedBytes: number, sizeBytes: number }>} */
  const spaces = {};
  for (const s of v8.getHeapSpaceStatistics()) spaces[s.space_name.replace(/_space$/, "")] = { usedBytes: s.space_used_size, sizeBytes: s.space_size };
  const active = /** @type {{ getActiveResourcesInfo?: () => string[] }} */ (process).getActiveResourcesInfo?.().length;
  return {
    type: "process.heap",
    heapSizeLimitBytes: h.heap_size_limit,
    mallocedBytes: h.malloced_memory,
    detachedContexts: h.number_of_detached_contexts,
    ...(active !== undefined ? { activeResources: active } : {}),
    spaces,
  };
}

/**
 * Writes a heap snapshot to `dir` and returns its path. Never taken automatically: it pauses the
 * process for about a second per 100 MB of heap and the file can hold any string the process holds
 * (personal data included), so it is for a developer on their own machine, on purpose.
 * @param {string} dir
 * @param {string} [label]
 */
export function writeHeapSnapshot(dir, label = "heap") {
  return v8.writeHeapSnapshot(join(dir, `${label}-${process.pid}-${Date.now()}.heapsnapshot`));
}

// ─── the collector ──────────────────────────────────────────────────────────────────────────────────

/** @typedef {{ timings: Map<string, number> }} RequestContext */

/** @type {Record<number, string>} */
const GC_KINDS = {
  [constants.NODE_PERFORMANCE_GC_MAJOR]: "major",
  [constants.NODE_PERFORMANCE_GC_MINOR]: "minor",
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: "incremental",
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: "weakcb",
};

/** @param {HostTelemetryOptions} opts */
export function createHostTelemetry(opts) {
  const intervalMs = opts.intervalMs ?? 10_000;
  const maxQueue = opts.maxQueue ?? 360;
  const degradedAt = opts.degradedLoopP99Ms ?? 200;
  const onError = opts.onError ?? (() => {});
  const instanceId = opts.instanceId ?? hostname();
  const maxSeries = Math.max(1, opts.maxSeries ?? 200);
  const heapEvery = opts.heapEvery ?? 6;
  let ticks = 0;
  const bootId = randomUUID();
  /** @type {AsyncLocalStorage<RequestContext>} */
  const als = new AsyncLocalStorage();

  let sequence = 0;
  /** @type {TelemetrySample[]} */
  let pending = [];
  /** @type {HostTelemetryEnvelope[]} */
  const queue = [];
  let sending = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let degraded = false;
  const stats = { sent: 0, dropped: 0, failures: 0 };

  // window state, reset on every tick
  let windowStart = performance.now();
  let elu = performance.eventLoopUtilization();
  const loop = monitorEventLoopDelay({ resolution: Math.max(1, opts.loopResolutionMs ?? 10) });
  /** @type {{ count: number, totalMs: number, maxMs: number, byKind: Record<string, { count: number, totalMs: number }> }} */
  let gc = { count: 0, totalMs: 0, maxMs: 0, byKind: {} };
  /** @type {Map<string, { method: string, route: string, status: string, d: Distribution, timings: Map<string, number> }>} */
  const requests = new Map();
  /** @type {Map<string, { d: Distribution, errors: number }>} */
  const queries = new Map();

  const gcObserver = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const kind = GC_KINDS[/** @type {{ detail?: { kind?: number } }} */ (e).detail?.kind ?? -1] ?? "other";
      gc.count++;
      gc.totalMs += e.duration;
      if (e.duration > gc.maxMs) gc.maxMs = e.duration;
      const k = (gc.byKind[kind] ??= { count: 0, totalMs: 0 });
      k.count++;
      k.totalMs += e.duration;
    }
  });

  /**
   * @param {LifecycleState} state
   * @param {string} [reason]
   */
  function lifecycle(state, reason) {
    pending.push({ type: "lifecycle", state, uptimeMs: round(performance.now()), ...(reason ? { reason } : {}) });
  }

  /** @param {RequestRecord} r */
  function recordRequest(r) {
    const status = `${Math.floor(r.status / 100)}xx`;
    let route = r.route;
    let key = `${r.method} ${route} ${status}`;
    if (!requests.has(key) && requests.size >= maxSeries) {
      route = OTHER;
      key = `${r.method} ${route} ${status}`;
    }
    let agg = requests.get(key);
    if (!agg) requests.set(key, (agg = { method: r.method, route, status, d: new Distribution(), timings: new Map() }));
    agg.d.add(r.ms);
    for (const [name, ms] of Object.entries(r.timings ?? {})) agg.timings.set(name, (agg.timings.get(name) ?? 0) + ms);
  }

  /**
   * @param {string} name
   * @param {number} ms
   * @param {boolean} [ok]
   */
  function recordQuery(name, ms, ok = true) {
    if (!queries.has(name) && queries.size >= maxSeries) name = OTHER;
    let agg = queries.get(name);
    if (!agg) queries.set(name, (agg = { d: new Distribution(), errors: 0 }));
    agg.d.add(ms);
    if (!ok) agg.errors++;
  }

  /**
   * adds `ms` to the current request's Server-Timing entry `name` (no-op outside a request)
   * @param {string} name
   * @param {number} ms
   */
  function serverTiming(name, ms) {
    const ctx = als.getStore();
    if (ctx) ctx.timings.set(name, (ctx.timings.get(name) ?? 0) + ms);
  }

  /**
   * times `fn` (monotonic clock) into the request's Server-Timing entry `name`
   * @template T
   * @param {string} name
   * @param {() => Promise<T> | T} fn
   * @returns {Promise<T>}
   */
  async function timed(name, fn) {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      serverTiming(name, performance.now() - t0);
    }
  }

  /**
   * a database query: counted under db.query `name`, and added to the request's Server-Timing "db"
   * @template T
   * @param {string} name a label, never the SQL
   * @param {() => Promise<T> | T} fn
   * @returns {Promise<T>}
   */
  async function query(name, fn) {
    const t0 = performance.now();
    let ok = false;
    try {
      const out = await fn();
      ok = true;
      return out;
    } finally {
      const ms = performance.now() - t0;
      recordQuery(name, ms, ok);
      serverTiming("db", ms);
    }
  }

  /** @param {MiddlewareOptions} [mo] */
  function middleware(mo = {}) {
    const tao = Array.isArray(mo.timingAllowOrigin) ? mo.timingAllowOrigin.join(", ") : mo.timingAllowOrigin;
    const withHeader = mo.serverTiming ?? true;
    const routeOf =
      mo.routeOf ??
      /** @param {IncomingMessage} req */
      ((req) => {
        const r = /** @type {IncomingMessage & { route?: { path?: unknown }, baseUrl?: string }} */ (req);
        return typeof r.route?.path === "string" ? (r.baseUrl ?? "") + r.route.path : "unmatched";
      });

    /**
     * @param {IncomingMessage} req
     * @param {ServerResponse} res
     * @param {(err?: unknown) => void} next
     */
    return (req, res, next) => {
      const t0 = performance.now();
      /** @type {RequestContext} */
      const ctx = { timings: new Map() };
      if (tao) res.setHeader("Timing-Allow-Origin", tao);
      if (withHeader) {
        // the header must be set before the head goes out; Node's implicit head (res.end without
        // writeHead) goes through writeHead too
        const writeHead = res.writeHead;
        res.writeHead = /** @type {typeof res.writeHead} */ (
          /** @this {ServerResponse} @param {...unknown} args */
          function (...args) {
            if (!res.headersSent) {
              const parts = [`app;dur=${round(performance.now() - t0)}`];
              for (const [name, ms] of ctx.timings) parts.push(`${name};dur=${round(ms)}`);
              const prev = res.getHeader("Server-Timing");
              res.setHeader("Server-Timing", [...(prev ? [String(prev)] : []), ...parts].join(", "));
            }
            return /** @type {(...a: unknown[]) => ServerResponse} */ (writeHead).apply(this, args);
          }
        );
      }
      res.once("finish", () => {
        recordRequest({ method: req.method ?? "GET", route: routeOf(req), status: res.statusCode, ms: performance.now() - t0, timings: Object.fromEntries(ctx.timings) });
      });
      als.run(ctx, () => next());
    };
  }

  /**
   * closes the current window: its samples, plus whatever lifecycle events were recorded in it
   * @returns {TelemetrySample[]}
   */
  function collect() {
    const now = performance.now();
    const window = round(now - windowStart);
    windowStart = now;
    /** @type {TelemetrySample[]} */
    const samples = [];

    const m = process.memoryUsage();
    samples.push({ type: "process.memory", rssBytes: m.rss, heapUsedBytes: m.heapUsed, heapTotalBytes: m.heapTotal, externalBytes: m.external, arrayBuffersBytes: m.arrayBuffers });
    if (heapEvery > 0 && ticks++ % heapEvery === 0) samples.push(heapSample());

    if (gc.count) {
      samples.push({ type: "gc", intervalMs: window, count: gc.count, totalMs: round(gc.totalMs), maxMs: round(gc.maxMs), byKind: Object.fromEntries(Object.entries(gc.byKind).map(([k, v]) => [k, { count: v.count, totalMs: round(v.totalMs) }])) });
      gc = { count: 0, totalMs: 0, maxMs: 0, byKind: {} };
    }

    if (loop.count > 0) {
      const p99 = nsToMs(loop.percentile(99));
      samples.push({ type: "event-loop.delay", intervalMs: window, minMs: nsToMs(loop.min), meanMs: nsToMs(loop.mean), p50Ms: nsToMs(loop.percentile(50)), p95Ms: nsToMs(loop.percentile(95)), p99Ms: p99, maxMs: nsToMs(loop.max), stddevMs: nsToMs(loop.stddev) });
      loop.reset();
      if (degradedAt > 0 && !degraded && p99 > degradedAt) {
        degraded = true;
        lifecycle("degraded", `event-loop p99 ${p99} ms > ${degradedAt} ms`);
      } else if (degraded && p99 <= degradedAt) {
        degraded = false;
        lifecycle("recovered", `event-loop p99 ${p99} ms`);
      }
    }

    const u = performance.eventLoopUtilization(elu);
    elu = performance.eventLoopUtilization();
    samples.push({ type: "event-loop.utilization", intervalMs: window, utilization: round(u.utilization), activeMs: round(u.active), idleMs: round(u.idle) });

    for (const r of requests.values()) {
      const s = r.d.summary();
      const timings = Object.fromEntries([...r.timings].map(([k, v]) => [k, round(v / s.count)]));
      samples.push({ type: "http.request", intervalMs: window, method: r.method, route: r.route, status: r.status, ...s, ...(r.timings.size ? { timings } : {}) });
    }
    requests.clear();
    for (const [name, q] of queries) samples.push({ type: "db.query", intervalMs: window, name, ...q.d.summary(), errors: q.errors });
    queries.clear();

    const out = [...pending, ...samples];
    pending = [];
    return out;
  }

  /**
   * @param {TelemetrySample[]} samples
   * @returns {HostTelemetryEnvelope}
   */
  function envelope(samples) {
    return { version: 1, source: opts.source, instanceId, bootId, sequence: sequence++, timestamp: new Date().toISOString(), samples };
  }

  async function drain() {
    if (sending) return;
    sending = true;
    try {
      // in order; the first failure stops the round and the envelope stays at the head of the queue
      while (queue.length) {
        try {
          await opts.send(queue[0]);
        } catch (err) {
          stats.failures++;
          onError(err);
          return;
        }
        queue.shift();
        stats.sent++;
      }
    } finally {
      sending = false;
    }
  }

  /** takes the samples now and sends them (and anything still queued) */
  async function flush() {
    queue.push(envelope(collect()));
    while (queue.length > maxQueue) {
      queue.shift();
      stats.dropped++;
    }
    await drain();
  }

  function start() {
    if (timer) return;
    loop.enable();
    gcObserver.observe({ entryTypes: ["gc"] });
    windowStart = performance.now();
    elu = performance.eventLoopUtilization();
    timer = setInterval(() => void flush().catch(onError), intervalMs);
    timer.unref();
  }

  async function stop(reason = "shutdown") {
    if (timer) clearInterval(timer);
    timer = null;
    lifecycle("stopping", reason);
    await flush().catch(onError);
    loop.disable();
    gcObserver.disconnect();
  }

  lifecycle("started");

  return {
    source: opts.source,
    instanceId,
    bootId,
    stats,
    get queued() {
      return queue.length;
    },
    start,
    stop,
    flush,
    collect,
    lifecycle,
    ready: () => lifecycle("ready"),
    /** @param {string} reason */
    degraded: (reason) => {
      degraded = true;
      lifecycle("degraded", reason);
    },
    /** @param {string} [reason] */
    recovered: (reason) => {
      degraded = false;
      lifecycle("recovered", reason);
    },
    recordRequest,
    recordQuery,
    serverTiming,
    timed,
    query,
    middleware,
  };
}

/** @typedef {ReturnType<typeof createHostTelemetry>} HostTelemetry */

/**
 * `send` for createHostTelemetry: POSTs the envelope as JSON with a bearer token; any non-2xx rejects.
 * @param {string} url
 * @param {string} [token]
 * @param {number} [timeoutMs]
 * @returns {(envelope: HostTelemetryEnvelope) => Promise<void>}
 */
export function httpSender(url, token, timeoutMs = 5000) {
  return async (envelope) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`POST ${url}: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
  };
}

/**
 * parses a Server-Timing header: "app;dur=18.4, db;dur=7.2;desc=x" → { app: 18.4, db: 7.2 }
 * @param {string | null | undefined} header
 * @returns {Record<string, number>}
 */
export function parseServerTiming(header) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const metric of (header ?? "").split(",")) {
    const [name, ...params] = metric.trim().split(";");
    if (!name) continue;
    const dur = params.map((p) => p.trim()).find((p) => p.startsWith("dur="));
    out[name.trim()] = dur ? Number(dur.slice(4)) : 0;
  }
  return out;
}
