-- Outbox of Jira issues: one row per (new auditoria, categoria it touches), written in the same
-- transaction as the auditoria, so no issue is lost; a background dispatcher sends them to Jira and
-- retries with backoff. Rows are only queued while Jira is connected and has a project configured.
CREATE TABLE IF NOT EXISTS "auditoria_jira_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "auditoria_id" uuid NOT NULL REFERENCES "auditorias"("id") ON DELETE CASCADE,
  "categoria_id" uuid NOT NULL,
  "categoria_nome" text NOT NULL, -- as it was when the auditoria was created
  -- pendente -> enviada | erro (retried until tentativas reaches the limit) | cancelada (auditoria deleted)
  "status" text NOT NULL DEFAULT 'pendente' CHECK ("status" IN ('pendente', 'enviada', 'erro', 'cancelada')),
  "issue_key" text,
  "issue_url" text,
  "tentativas" integer NOT NULL DEFAULT 0,
  "ultimo_erro" text,
  "proxima_tentativa_em" timestamptz NOT NULL DEFAULT now(),
  "criado_em" timestamptz NOT NULL DEFAULT now(),
  "enviado_em" timestamptz,
  UNIQUE ("auditoria_id", "categoria_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditoria_jira_issues_fila_idx"
  ON "auditoria_jira_issues" ("proxima_tentativa_em") WHERE "status" IN ('pendente', 'erro');
