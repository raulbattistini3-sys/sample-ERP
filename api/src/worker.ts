// Long-lived background worker (API_ROLE=worker): runs the pg-boss consumers of the integration queues in
// their own process, so their allocations never land on the API's heap. One process for all jobs (no fork
// per job); concurrency is bounded by the queue options; payloads carry ids only. The launcher supervises it.
process.env.API_ROLE = "worker";
import { integracaoEnvioWorker } from "./routes/integracao.routes";

void integracaoEnvioWorker.start({ consume: true });
console.log("background worker started");

// let running jobs finish and close pg-boss's connections, then exit
const shutdown = async () => {
   await integracaoEnvioWorker.stop();
   process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
