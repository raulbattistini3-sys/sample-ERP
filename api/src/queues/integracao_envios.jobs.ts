import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { DrizzleDB } from "../db/client";
import { Provider } from "../configs/oauth.providers";
import { queueClient } from "./queue.client";

// One pg-boss queue per provider, so one provider's rate limits or outage never delays the other.
// A job = "create the issue/ticket of this auditoria_integracao_envios row".
export const ENVIO_QUEUES: Record<Provider, { queue: string; dlq: string }> = {
  jira: { queue: "jira-issues", dlq: "jira-issues-dlq" },
  hubspot: { queue: "hubspot-tickets", dlq: "hubspot-tickets-dlq" },
};

export const MAX_ATTEMPTS = 8; // then the dead-letter queue, and "Reenviar" on the Integrações page
const RETRY_DELAY_SECONDS = 60;
const RETRY_DELAY_MAX_SECONDS = 30 * 60;
// a worker that dies mid-job gives the job back after this; the row's lease is shorter (see the worker)
export const JOB_EXPIRE_SECONDS = 5 * 60;

export const envioQueueOptions = (provider: Provider) => ({
  retryLimit: MAX_ATTEMPTS - 1, // retries after the first attempt
  retryDelay: RETRY_DELAY_SECONDS,
  retryBackoff: true, // ~1, 2, 4, 8, 16 minutes... capped at 30 (pg-boss adds jitter)
  retryDelayMax: RETRY_DELAY_MAX_SECONDS,
  expireInSeconds: JOB_EXPIRE_SECONDS,
  deadLetter: ENVIO_QUEUES[provider].dlq,
});

// approximate wait before the next attempt, for the pages ("nova tentativa em ...")
export const approxRetryDelayMs = (retryCount: number) =>
  Math.min(RETRY_DELAY_MAX_SECONDS, RETRY_DELAY_SECONDS * 2 ** retryCount) * 1000;

export type EnvioJob = { envioId: string };

// Inserts the jobs on the caller's transaction (the auditoria's), so a job exists exactly when its row
// does. Returns false when the queue isn't running; the rows then keep job_id NULL and get their jobs
// when it starts (IntegracaoEnvioWorker.enqueueMissing).
export async function enqueueEnvioJobs(tx: DrizzleDB, envios: { id: string; provider: Provider }[]): Promise<boolean> {
  if (envios.length === 0 || !queueClient.isStarted) return false;
  const db = fromDrizzle(tx, sql);
  for (const envio of envios) {
    const jobId = await queueClient.boss.send(ENVIO_QUEUES[envio.provider].queue, { envioId: envio.id } satisfies EnvioJob, { db });
    if (jobId) await tx.execute(sql`update auditoria_integracao_envios set job_id = ${jobId} where id = ${envio.id}`);
  }
  return true;
}
