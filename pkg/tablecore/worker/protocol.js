// Messages between the page and the compute worker. Every message is a plain
// object with a `type`; anything heavier than a few numbers is an ArrayBuffer
// in the transfer list, never a nested JS structure that would be cloned.

/** @typedef {import("../types.js").OpSpec} OpSpec */
/** @typedef {import("../types.js").OpResult} OpResult */

/**
 * How the worker gets the dataset.
 * - `clone`: the ArrayBuffer is structured-cloned (a memcpy on the main thread)
 * - `shared`: a SharedArrayBuffer, zero copy; needs cross-origin isolation
 * - `fetch`: the worker downloads the file itself; the main thread never copies,
 *   but the worker's own CSP `connect-src` must allow the URL
 * @typedef {"clone" | "shared" | "fetch"} InitMode
 */

/**
 * @typedef {{ type: "init", mode: "clone" | "shared", buffer: ArrayBuffer | SharedArrayBuffer }
 *   | { type: "init", mode: "fetch", url: string }
 *   | { type: "run", id: number, channel: string, spec: OpSpec }
 *   | { type: "ping", id: number }} ToWorker
 */

/**
 * Times are absolute (`performance.timeOrigin + performance.now()`), because
 * the worker and the page each have their own `performance.now()` origin.
 * @typedef {Omit<OpResult, "indices">} OpStats
 */

/**
 * @typedef {{ type: "ready", rows: number, initMs: number, mode: InitMode }
 *   | { type: "result", id: number, channel: string, indices: Uint32Array, stats: OpStats, tRecv: number, tStart: number, tEnd: number }
 *   | { type: "skipped", id: number, channel: string }
 *   | { type: "error", id: number | null, message: string }
 *   | { type: "pong", id: number, t: number }} FromWorker
 */

/** Absolute timestamp in ms, comparable across threads. */
export const now = () => performance.timeOrigin + performance.now();

export {};
