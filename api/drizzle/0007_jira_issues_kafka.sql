-- The Jira issue queue moves to Kafka; auditoria_jira_issues stays as the transactional outbox and the
-- record shown on the pages. New in-flight states:
--   publicada: the relay put it on the Kafka topic (proxima_tentativa_em = until when that counts)
--   enviando:  a consumer claimed it and is calling Jira (proxima_tentativa_em = its lease)
-- A row stuck in either past proxima_tentativa_em (process died mid-way) is published again.
ALTER TABLE "auditoria_jira_issues" DROP CONSTRAINT IF EXISTS "auditoria_jira_issues_status_check";
--> statement-breakpoint
ALTER TABLE "auditoria_jira_issues" ADD CONSTRAINT "auditoria_jira_issues_status_check"
  CHECK ("status" IN ('pendente', 'publicada', 'enviando', 'enviada', 'erro', 'cancelada'));
--> statement-breakpoint
DROP INDEX IF EXISTS "auditoria_jira_issues_fila_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditoria_jira_issues_relay_idx"
  ON "auditoria_jira_issues" ("criado_em") WHERE "status" IN ('pendente', 'publicada', 'enviando', 'erro');
