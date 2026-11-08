// Compute worker. Holds its own view of the dataset and runs the same
// `runOp` as the main thread. Start it as a module worker:
//   new Worker(new URL("./worker.js", import.meta.url), { type: "module" })

import { openColumnar } from "../columnar.js";
import { runOp } from "../compute.js";
import { now } from "./protocol.js";

/** @typedef {import("./protocol.js").ToWorker} ToWorker */
/** @typedef {import("./protocol.js").FromWorker} FromWorker */
/** @typedef {import("../types.js").Dataset} Dataset */

/** @type {Dataset | null} */
let ds = null;

/** @type {{ msg: Extract<ToWorker, { type: "run" }>, tRecv: number }[]} */
let queue = [];
let draining = false;

/**
 * @param {FromWorker} msg
 * @param {Transferable[]} [transfer]
 */
function send(msg, transfer = []) {
  self.postMessage(msg, { transfer });
}

self.onmessage = async (/** @type {MessageEvent<ToWorker>} */ e) => {
  const msg = e.data;
  const tRecv = now();
  try {
    switch (msg.type) {
      case "init": {
        const t0 = performance.now();
        const buffer = msg.mode === "fetch" ? await (await fetch(msg.url)).arrayBuffer() : msg.buffer;
        ds = openColumnar(buffer);
        send({ type: "ready", rows: ds.rows, initMs: performance.now() - t0, mode: msg.mode });
        break;
      }
      case "ping":
        send({ type: "pong", id: msg.id, t: tRecv });
        break;
      case "run":
        queue.push({ msg, tRecv });
        // Let messages already waiting in the event loop arrive first, so a
        // burst (typing in a filter box) collapses to its newest request.
        // Best effort: the page still drops stale replies by id.
        if (!draining) {
          draining = true;
          setTimeout(drain, 0);
        }
        break;
    }
  } catch (err) {
    send({ type: "error", id: msg.type === "run" ? msg.id : null, message: String(err) });
  }
};

function drain() {
  draining = false;
  const batch = queue;
  queue = [];
  /** @type {Map<string, number>} */
  const newest = new Map();
  for (const { msg } of batch) newest.set(msg.channel, Math.max(newest.get(msg.channel) ?? -1, msg.id));

  for (const { msg, tRecv } of batch) {
    if (msg.id !== newest.get(msg.channel)) {
      send({ type: "skipped", id: msg.id, channel: msg.channel });
      continue;
    }
    if (!ds) {
      send({ type: "error", id: msg.id, message: "worker not initialised" });
      continue;
    }
    try {
      const tStart = now();
      const { indices, ...stats } = runOp(ds, msg.spec);
      const tEnd = now();
      // Transfer, not clone: the index buffer moves to the page in O(1).
      send({ type: "result", id: msg.id, channel: msg.channel, indices, stats, tRecv, tStart, tEnd }, [indices.buffer]);
    } catch (err) {
      send({ type: "error", id: msg.id, message: String(err) });
    }
  }
}
