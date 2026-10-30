-- Companies: a local copy of the HubSpot companies, refreshed with the contacts. A contact can belong to
-- several, so clientes keeps their HubSpot ids. cargo is the jobtitle, senioridade the hs_seniority and
-- papeis the hs_buying_role values (DECISION_MAKER, BUDGET_HOLDER, ...).
CREATE TABLE IF NOT EXISTS "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hubspot_id" text NOT NULL UNIQUE,
	"nome" text NOT NULL,
	"dominio" text,
	"setor" text,
	"url" text,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "empresas_nome_idx" ON "empresas" (lower("nome"));
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "cargo" text;
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "senioridade" text;
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "papeis" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "empresas_hubspot_ids" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clientes_empresas_idx" ON "clientes" USING gin ("empresas_hubspot_ids");
