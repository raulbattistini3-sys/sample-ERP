// Runtime signal collectors. Each one converts browser entries into plain
// TelemetryEvents straight away: performance entries hold references the
// structured clone can't copy, and plain objects can cross into the extension.

/** @typedef {import("./bus.js").Collector} Collector */
/** @typedef {import("../tablecore/types.js").TelemetryEvent} TelemetryEvent */

/**
 * Only the LoAF fields we use. TypeScript's DOM lib doesn't ship these yet.
 * @typedef {object} LoafEntry
 * @property {number} startTime
 * @property {number} duration
 * @property {number} blockingDuration
 * @property {number} renderStart
 * @property {{ sourceURL: string, invoker: string, invokerType: string, duration: number }[]} scripts
 */

const supportsEntry = (/** @type {string} */ type) =>
  typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes(type);

/**
 * Long Animation Frames (Chromium 123+). Falls back to Long Tasks, which have
 * no script attribution. Script URLs are kept so frames caused by an
 * extension (chrome-extension://…) can be told apart from the page.
 *
 * @returns {Collector}
 */
export function loafCollector() {
  /** @type {PerformanceObserver | null} */
  let obs = null;
  const loaf = supportsEntry("long-animation-frame");
  return {
    name: loaf ? "long-animation-frame" : "longtask",
    supported: () => loaf || supportsEntry("longtask"),
    start(emit) {
      obs = new PerformanceObserver((list) => {
        for (const raw of list.getEntries()) {
          if (loaf) {
            const e = /** @type {LoafEntry} */ (/** @type {unknown} */ (raw));
            emit({
              source: "loaf",
              type: "frame",
              ts: e.startTime,
              data: {
                duration: e.duration,
                blockingDuration: e.blockingDuration,
                scripts: e.scripts.map((s) => ({ url: s.sourceURL, invoker: s.invoker, type: s.invokerType, duration: s.duration })),
              },
            });
          } else {
            emit({
              source: "longtask",
              type: "frame",
              ts: raw.startTime,
              data: { duration: raw.duration, blockingDuration: Math.max(0, raw.duration - 50), scripts: [] },
            });
          }
        }
      });
      obs.observe({ type: loaf ? "long-animation-frame" : "longtask", buffered: true });
    },
    stop: () => obs?.disconnect(),
  };
}

/**
 * Event Timing: one event per interaction, the input to INP.
 *
 * @returns {Collector}
 */
export function interactionCollector() {
  /** @type {PerformanceObserver | null} */
  let obs = null;
  return {
    name: "event-timing",
    supported: () => supportsEntry("event"),
    start(emit) {
      obs = new PerformanceObserver((list) => {
        for (const raw of list.getEntries()) {
          const e = /** @type {PerformanceEventTiming & { interactionId?: number }} */ (raw);
          if (!e.interactionId) continue;
          emit({
            source: "event-timing",
            type: "interaction",
            ts: e.startTime,
            data: {
              name: e.name,
              interactionId: e.interactionId,
              duration: e.duration,
              inputDelay: e.processingStart - e.startTime,
              processing: e.processingEnd - e.processingStart,
            },
          });
        }
      });
      obs.observe(/** @type {PerformanceObserverInit} */ ({ type: "event", durationThreshold: 16, buffered: true }));
    },
    stop: () => obs?.disconnect(),
  };
}

/**
 * Compute Pressure (Chromium 125+): nominal / fair / serious / critical.
 * Coarse on purpose (privacy), and it covers the whole system, not this tab.
 *
 * @param {{ sampleInterval?: number }} [options]
 * @returns {Collector}
 */
export function pressureCollector({ sampleInterval = 1000 } = {}) {
  /** @type {any} */
  const PO = /** @type {any} */ (globalThis).PressureObserver;
  /** @type {any} */
  let obs = null;
  return {
    name: "compute-pressure",
    supported: () => typeof PO === "function",
    start(emit) {
      obs = new PO((/** @type {{ state: string, time: number, source: string }[]} */ records) => {
        // PressureRecord.time is already relative to timeOrigin, like performance.now() (the prototype
        // subtracted timeOrigin again, giving large negative timestamps)
        for (const r of records) emit({ source: "pressure", type: "state", ts: r.time, data: { state: r.state, source: r.source } });
      });
      // Rejects when a Permissions-Policy forbids compute-pressure (e.g. in iframes).
      obs.observe("cpu", { sampleInterval }).catch((/** @type {unknown} */ err) =>
        emit({ source: "pressure", type: "error", ts: performance.now(), data: { message: String(err) } }),
      );
    },
    stop: () => obs?.disconnect(),
  };
}

/**
 * JS heap size. `performance.memory` is Chromium-only and coarse; the precise
 * `measureUserAgentSpecificMemory` needs cross-origin isolation.
 *
 * @param {{ intervalMs?: number }} [options]
 * @returns {Collector}
 */
export function memoryCollector({ intervalMs = 2000 } = {}) {
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  const mem = () => /** @type {{ memory?: { usedJSHeapSize: number, totalJSHeapSize: number, jsHeapSizeLimit: number } }} */ (performance).memory;
  return {
    name: "memory",
    supported: () => mem() !== undefined,
    start(emit) {
      timer = setInterval(() => {
        const m = mem();
        if (m) emit({ source: "memory", type: "heap", ts: performance.now(), data: { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit } });
      }, intervalMs);
    },
    stop: () => clearInterval(timer),
  };
}

const r1 = (/** @type {number} */ v) => Math.round(Math.max(0, v) * 10) / 10;

/**
 * The network phases of one navigation or resource entry: redirect, DNS, TCP (TLS included), TLS, fila
 * (waiting for the request to go out once the connection is ready), TTFB and download. A cross-origin entry
 * without Timing-Allow-Origin only has its duration: timingAllowed is false and the phases are zero.
 *
 * @param {PerformanceResourceTiming} e
 */
export function phasesOf(e) {
  const timingAllowed = e.responseStart > 0 || e.requestStart > 0;
  const connectStart = e.connectStart || e.fetchStart;
  const connectEnd = e.connectEnd || e.fetchStart;
  return {
    redirectMs: r1(e.redirectEnd - e.redirectStart),
    dnsMs: r1(e.domainLookupEnd - e.domainLookupStart),
    tcpMs: r1(connectEnd - connectStart),
    tlsMs: e.secureConnectionStart > 0 ? r1(connectEnd - e.secureConnectionStart) : 0,
    filaMs: timingAllowed ? r1(e.requestStart - connectEnd) : 0,
    ttfbMs: timingAllowed ? r1(e.responseStart - e.requestStart) : 0,
    downloadMs: timingAllowed ? r1(e.responseEnd - e.responseStart) : 0,
    durationMs: r1(e.duration),
    reusedConnection: e.connectStart === e.connectEnd,
    timingAllowed,
    transferSize: e.transferSize ?? null,
    decodedBodySize: e.decodedBodySize ?? null,
  };
}

/**
 * Navigation and resource timing as phases. The navigation (the HTML document) is emitted once; resources
 * are the API calls (fetch/XHR) and the bundle's scripts and styles, so a slow first load shows whether it
 * was DNS, the connection, the queue, the server or the download of a big chunk. Paths only, never the
 * query string (it can carry search terms).
 *
 * The telemetry upload itself is skipped (`exclude`), or each send would report the previous one forever.
 *
 * @param {{ initiators?: string[], exclude?: RegExp }} [options]
 * @returns {Collector}
 */
export function resourceCollector({ initiators = ["fetch", "xmlhttprequest", "script", "link", "css"], exclude = /\/telemetry(\/|$)/ } = {}) {
  /** @type {PerformanceObserver[]} */
  const obs = [];
  const path = (/** @type {string} */ name) => {
    try {
      const u = new URL(name);
      return u.origin === location.origin ? u.pathname : u.host + u.pathname;
    } catch {
      return name.split(/[?#]/)[0];
    }
  };
  return {
    name: "resource-timing",
    supported: () => supportsEntry("resource"),
    start(emit) {
      const observe = (/** @type {string} */ type, /** @type {(e: PerformanceResourceTiming) => void} */ fn) => {
        if (!supportsEntry(type)) return;
        const o = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) fn(/** @type {PerformanceResourceTiming} */ (e));
        });
        o.observe({ type, buffered: true });
        obs.push(o);
      };
      observe("navigation", (e) => emit({ source: "network", type: "navigation", ts: e.startTime, data: { url: path(e.name), ...phasesOf(e) } }));
      observe("resource", (e) => {
        if (!initiators.includes(e.initiatorType)) return;
        const url = path(e.name);
        if (exclude.test(url)) return;
        emit({ source: "network", type: "resource", ts: e.startTime, data: { url, initiator: e.initiatorType, ...phasesOf(e) } });
      });
    },
    stop: () => obs.forEach((o) => o.disconnect()),
  };
}

/** Every collector with default settings. */
export const defaultCollectors = () => [loafCollector(), interactionCollector(), pressureCollector(), memoryCollector(), resourceCollector()];
