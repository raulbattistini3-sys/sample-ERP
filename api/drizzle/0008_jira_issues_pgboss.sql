-- The Jira issue queue moves from Kafka to pg-boss (jobs in this same Postgres, schema "pgboss").
-- The job is inserted in the auditoria's transaction, next to its auditoria_jira_issues row, so the job
-- itself is the outbox. job_id records it; a row without one (the queue wasn't running when the
-- auditoria was saved, or it was waiting on the old Kafka relay) gets a job when the queue starts.
-- 'publicada' (Kafka) is no longer used: such rows go back to 'pendente' to be enqueued.
ALTER TABLE "auditoria_jira_issues" ADD COLUMN IF NOT EXISTS "job_id" uuid;
--> statement-breakpoint
UPDATE "auditoria_jira_issues" SET "status" = 'pendente', "job_id" = NULL WHERE "status" = 'publicada';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditoria_jira_issues_sem_job_idx"
  ON "auditoria_jira_issues" ("criado_em") WHERE "status" = 'pendente' AND "job_id" IS NULL;
