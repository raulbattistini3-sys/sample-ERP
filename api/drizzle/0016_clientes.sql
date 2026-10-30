-- Customers: a local copy of the HubSpot contacts, refreshed by POST /clientes/sincronizar. HubSpot owns
-- this data, so nothing is edited here, and a contact gone from HubSpot is gone from here on the next sync.
CREATE TABLE IF NOT EXISTS "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hubspot_id" text NOT NULL UNIQUE,
	"nome" text NOT NULL,
	"email" text,
	"telefone" text,
	"empresa" text,
	"estagio" text,
	"url" text,
	"criado_no_hubspot_em" timestamp with time zone,
	"atualizado_no_hubspot_em" timestamp with time zone,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clientes_nome_idx" ON "clientes" (lower("nome"));
