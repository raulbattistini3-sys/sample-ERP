// Telemetry package: one event shape ({ source, type, ts, data }), collectors that produce events,
// exporters that send them somewhere, and a bus between the two. Same shape as a Go agent's
// collector → chan event.Event → exporter, so the API, the web app and a Go service can share one
// event format. Browser collectors are in collectors.js; everything else runs anywhere.

export { createTelemetry } from "./bus.js";
export { loafCollector, interactionCollector, pressureCollector, memoryCollector, defaultCollectors } from "./collectors.js";
export {
  signalsExporter,
  extensionBridgeExporter,
  beaconExporter,
  fetchExporter,
  ndjsonExporter,
  memoryExporter,
  BRIDGE_CHANNEL,
} from "./exporters.js";
