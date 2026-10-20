import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { DrizzleDB } from "../db/client";
import { queueClient } from "./queue.client";

// One job per auditoria_jira_issues row: "create this Jira issue".
export const JIRA_ISSUES_QUEUE = "jira-issues";
export const JIRA_ISSUES_DLQ = "jira-issues-dlq"; // jobs that failed every attempt (kept for inspection)

export const MAX_ATTEMPTS = 8; // then the dead-letter queue, and "Reenviar" on the Integrações page
const RETRY_DELAY_SECONDS = 60;
const RETRY_DELAY_MAX_SECONDS = 30 * 60;
// a worker that dies mid-job gives the job back after this; the outbox lease is shorter (see the worker)
export const JOB_EXPIRE_SECONDS = 5 * 60;

export const jiraIssuesQueueOptions = {
  retryLimit: MAX_ATTEMPTS - 1, // retries after the first attempt
  retryDelay: RETRY_DELAY_SECONDS,
  retryBackoff: true, // ~1, 2, 4, 8, 16 minutes... capped at 30 (pg-boss adds jitter)
  retryDelayMax: RETRY_DELAY_MAX_SECONDS,
  expireInSeconds: JOB_EXPIRE_SECONDS,
  deadLetter: JIRA_ISSUES_DLQ,
};

// approximate wait before the next attempt, for the pages ("nova tentativa em ...")
export const approxRetryDelayMs = (retryCount: number) =>
  Math.min(RETRY_DELAY_MAX_SECONDS, RETRY_DELAY_SECONDS * 2 ** retryCount) * 1000;

export type JiraIssueJob = { outboxId: string };

// Inserts the jobs on the caller's transaction (the auditoria's), so a job exists exactly when its
// outbox row does. Returns false when the queue isn't running; the rows then keep job_id NULL and get
// their jobs when it starts (JiraIssueWorker.enqueueMissing).
export async function enqueueJiraIssueJobs(tx: DrizzleDB, outboxIds: string[]): Promise<boolean> {
  if (outboxIds.length === 0 || !queueClient.isStarted) return false;
  const db = fromDrizzle(tx, sql);
  for (const outboxId of outboxIds) {
    const jobId = await queueClient.boss.send(JIRA_ISSUES_QUEUE, { outboxId } satisfies JiraIssueJob, { db });
    if (jobId) await tx.execute(sql`update auditoria_jira_issues set job_id = ${jobId} where id = ${outboxId}`);
  }
  return true;
}
