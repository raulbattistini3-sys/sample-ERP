-- The queue of issues/items for new auditorias now serves every integration (Jira, monday): one row per
-- (auditoria, categoria it touches, provider). Existing rows are Jira's and keep their data.
ALTER TABLE "auditoria_jira_issues" RENAME TO "auditoria_integracao_envios";
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" ADD COLUMN IF NOT EXISTS "provider" "integracao_provider" NOT NULL DEFAULT 'jira';
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" ALTER COLUMN "provider" DROP DEFAULT;
--> statement-breakpoint
-- Jira issue key / monday item id, and the link to it
ALTER TABLE "auditoria_integracao_envios" RENAME COLUMN "issue_key" TO "external_id";
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" RENAME COLUMN "issue_url" TO "external_url";
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" DROP CONSTRAINT "auditoria_jira_issues_auditoria_id_categoria_id_key";
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" ADD CONSTRAINT "auditoria_integracao_envios_unico" UNIQUE ("auditoria_id", "categoria_id", "provider");
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" RENAME CONSTRAINT "auditoria_jira_issues_pkey" TO "auditoria_integracao_envios_pkey";
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" RENAME CONSTRAINT "auditoria_jira_issues_auditoria_id_fkey" TO "auditoria_integracao_envios_auditoria_id_fkey";
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" RENAME CONSTRAINT "auditoria_jira_issues_status_check" TO "auditoria_integracao_envios_status_check";
--> statement-breakpoint
-- leftover from the Kafka relay
DROP INDEX IF EXISTS "auditoria_jira_issues_relay_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "auditoria_jira_issues_sem_job_idx" RENAME TO "auditoria_integracao_envios_sem_job_idx";
