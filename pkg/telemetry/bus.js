// The Go agent's shape, in the browser:
//
//   Go                                   here
//   collector.ICollector.Collect(ctx,ch) Collector.start(emit) / stop()
//   chan event.Event                     emit() → synchronous fan-out
//   exporter.Exporter.Export(ctx, e)     Exporter.export(e)
//   ctx.Done()                           bus.stop()
//
// There is one thread, so there is no channel or WaitGroup: emit() calls each
// exporter in turn. Exporters must stay cheap (buffer, then flush on a timer),
// because whatever they cost lands on the main thread we are measuring.

/** @typedef {import("../tablecore/types.js").TelemetryEvent} TelemetryEvent */

/**
 * @typedef {object} Collector
 * @property {string} name
 * @property {() => boolean} supported feature check; unsupported collectors are skipped and reported
 * @property {(emit: (e: TelemetryEvent) => void) => void} start
 * @property {() => void} stop
 */

/**
 * @typedef {object} Exporter
 * @property {string} name
 * @property {(e: TelemetryEvent) => void} export
 * @property {() => void} [flush]
 * @property {() => void} [stop]
 */

/**
 * @param {{ collectors: Collector[], exporters: Exporter[] }} options
 */
export function createTelemetry({ collectors, exporters }) {
  let running = false;
  /** @type {Collector[]} */
  let active = [];

  /** @param {TelemetryEvent} e */
  const emit = (e) => {
    if (!running) return;
    for (const ex of exporters) {
      try {
        ex.export(e);
      } catch (err) {
        console.warn(`[tcc] exporter ${ex.name} failed`, err);
      }
    }
  };

  return {
    emit,
    /** Starts every supported collector and reports which ones ran. */
    start() {
      if (running) return;
      running = true;
      active = collectors.filter((c) => c.supported());
      const skipped = collectors.filter((c) => !active.includes(c)).map((c) => c.name);
      emit({
        source: "bus",
        type: "capabilities",
        ts: performance.now(),
        data: {
          active: active.map((c) => c.name),
          skipped,
          crossOriginIsolated: globalThis.crossOriginIsolated === true,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: /** @type {{ deviceMemory?: number }} */ (navigator).deviceMemory ?? null,
          userAgent: navigator.userAgent,
        },
      });
      for (const c of active) c.start(emit);
    },
    stop() {
      for (const c of active) c.stop();
      for (const ex of exporters) {
        ex.flush?.();
        ex.stop?.();
      }
      running = false;
    },
  };
}
