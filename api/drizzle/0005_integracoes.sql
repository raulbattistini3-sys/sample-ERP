-- OAuth connections to external tools (src/configs/oauth.providers.ts). One connection per provider:
-- the ERP is a single company, so connecting Jira again replaces the previous connection.
-- Tokens are stored encrypted (AES-256-GCM, key in INTEGRATIONS_ENCRYPTION_KEY), never in plain text.
CREATE TYPE "integracao_provider" AS ENUM ('jira', 'monday');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integracoes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" "integracao_provider" NOT NULL UNIQUE,
  "access_token_cifrado" text NOT NULL,
  "refresh_token_cifrado" text,
  "expira_em" timestamptz,
  "escopos" text NOT NULL DEFAULT '',
  -- the connected account, e.g. Jira: { "cloudId", "siteName", "siteUrl" }
  "conta_externa" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- what the ERP does with it, e.g. Jira: { "projectKey", "projectName", "issueTypeId", "issueTypeName" }
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "conectado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
  "conectado_em" timestamptz NOT NULL DEFAULT now(),
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- the OAuth "state" sent to the provider: single use, 10 minutes, tied to who started the connection.
-- Only its SHA-256 is stored.
CREATE TABLE IF NOT EXISTS "oauth_estados" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" "integracao_provider" NOT NULL,
  "estado_hash" text NOT NULL UNIQUE,
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "expira_em" timestamptz NOT NULL,
  "usado_em" timestamptz
);
