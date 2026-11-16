// Long-lived background worker (API_ROLE=worker): runs the pg-boss consumers of the integration queues in
// their own process, so their allocations never land on the API's heap. pg-boss does not create a process
// of its own: boss.work() callbacks run in whichever process calls it, and that is this one. One process for
// all jobs (no fork per job); payloads carry ids only.
//
// Supervised by polyvisor (or the launcher without it) in its own job object: POLYVISOR_MEMORY_HARD_BYTES is
// the whole process's limit, and the heap is capped below it (node: --max-old-space-size; the compiled Bun
// executable: BUN_JSC_forceRAMSize, which the launcher sets from the same limit), so the heap sees the limit
// and collects before the job object refuses an allocation. polyvisor's pressure pauses consumption at
// "critical" and resumes it when the pressure drops; POLYVISOR_MAX_CONCURRENCY bounds the jobs at once.
process.env.API_ROLE = "worker";
import { getHeapStatistics } from "node:v8";
import { integracaoEnvioWorker } from "./routes/integracao.routes";
import { startAdaptive, stopAdaptive } from "./utils/telemetry/adaptive";

const MB = 1024 * 1024;
const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

function describeLimits(): string {
   const hard = num(process.env.POLYVISOR_MEMORY_HARD_BYTES);
   const soft = num(process.env.POLYVISOR_MEMORY_SOFT_BYTES);
   const jsc = num(process.env.BUN_JSC_forceRAMSize);
   const heap = getHeapStatistics().heap_size_limit;
   return [
      hard ? `process limit ${Math.round(hard / MB)} MB` : "no process limit",
      soft ? `soft ${Math.round(soft / MB)} MB` : null,
      jsc ? `JSC RAM ${Math.round(jsc / MB)} MB` : null,
      // Bun reports the machine's RAM here, not a cap: only meaningful under node
      process.versions.bun ? null : `heap limit ${Math.round(heap / MB)} MB`,
   ]
      .filter(Boolean)
      .join(", ");
}

let stopping: Promise<void> | null = null;

async function main() {
   const concurrency = num(process.env.POLYVISOR_MAX_CONCURRENCY) ?? num(process.env.WORKER_CONCURRENCY);
   await startAdaptive(
      (m) => console.log(`[worker adaptive] ${m}`),
      (level) => void (level === "critical" ? integracaoEnvioWorker.pause() : integracaoEnvioWorker.resume()),
   );
   await integracaoEnvioWorker.start({ consume: true, concurrency });
   console.log(`background worker started (${describeLimits()}${concurrency ? `, concurrency ${concurrency}` : ""})`);
}

// let running jobs finish and close pg-boss's connections, then exit. polyvisor stops a service with its own
// process group by CTRL_BREAK on Windows (SIGBREAK), SIGTERM on Linux; a console Ctrl+C is SIGINT.
function shutdown(signal: string) {
   if (stopping) return;
   console.log(`background worker stopping (${signal})`);
   const force = setTimeout(() => process.exit(1), 14_000);
   force.unref();
   stopping = integracaoEnvioWorker
      .stop()
      .catch((err) => console.error("worker stop failed", err))
      .finally(() => {
         stopAdaptive();
         process.exit(0);
      });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.once(signal, () => shutdown(signal));

main().catch((err) => {
   console.error("background worker failed to start", err);
   process.exit(1);
});
