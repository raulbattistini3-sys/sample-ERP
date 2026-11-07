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

/** Every collector with default settings. */
export const defaultCollectors = () => [loafCollector(), interactionCollector(), pressureCollector(), memoryCollector()];
