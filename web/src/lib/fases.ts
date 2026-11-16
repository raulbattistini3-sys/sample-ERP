// The network phases of one request, from the browser's PerformanceResourceTiming entry: the same split
// the TCC extension's probe makes for page loads (redirect, DNS, TCP+TLS, fila, TTFB, download), so a
// search or list event says where its network time went instead of one "redeMs" number.
//
// The API answers with Timing-Allow-Origin; without it a cross-origin entry has only its duration and every
// phase is zero (timingAllowed: false says so).
import { phasesOf } from "@pkg/telemetry/collectors.js";

export type Fases = ReturnType<typeof phasesOf>;

/**
 * The phases of the request to `url` that started at or after `desde` (performance.now() before the call).
 * The entry is queued once the body is read, so call this after awaiting the response. Null when the
 * browser has no entry (not supported, buffer full, or the request never left).
 */
export function fasesDaRequisicao(url: string, desde: number): Fases | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  // axios URLs are relative to the API base and carry their params separately: match on the bare path
  const caminho = "/" + url.split(/[?#]/)[0]!.replace(/^(https?:\/\/[^/]+)?\/*/, "");
  const entradas = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (let i = entradas.length - 1; i >= 0; i--) {
    const e = entradas[i]!;
    if (e.startTime + 1 < desde) break; // ordered by start: everything earlier is another request
    if (e.initiatorType !== "xmlhttprequest" && e.initiatorType !== "fetch") continue;
    if (e.name.split(/[?#]/)[0]!.endsWith(caminho)) return phasesOf(e);
  }
  return null;
}

// a long session fills the resource buffer (250 entries by default) and new requests stop being recorded
if (typeof performance !== "undefined" && typeof performance.setResourceTimingBufferSize === "function") {
  performance.setResourceTimingBufferSize(2000);
  performance.addEventListener?.("resourcetimingbufferfull", () => performance.clearResourceTimings());
}
