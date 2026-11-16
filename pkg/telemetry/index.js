// Telemetry package: one event shape ({ source, type, ts, data }), collectors that produce events,
// exporters that send them somewhere, and a bus between the two. Same shape as a Go agent's
// collector → chan event.Event → exporter, so the API, the web app and a Go service can share one
// event format. Browser collectors are in collectors.js; everything else runs anywhere.
// A Node service's own metrics (GC, event loop, request and query timings, Server-Timing) are in
// host.js, imported directly: it needs node:perf_hooks, so it stays out of this browser-safe entry.

export { createTelemetry } from "./bus.js";
export { loafCollector, interactionCollector, pressureCollector, memoryCollector, resourceCollector, phasesOf, defaultCollectors } from "./collectors.js";
export {
  signalsExporter,
  extensionBridgeExporter,
  beaconExporter,
  fetchExporter,
  ndjsonExporter,
  memoryExporter,
  BRIDGE_CHANNEL,
} from "./exporters.js";
