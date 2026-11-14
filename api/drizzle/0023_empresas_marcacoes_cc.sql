-- What the ERP itself knows about a HubSpot company (companies stay in HubSpot, read live). The SAC e-mail
-- is the company's customer-service inbox: it is copied on the client's e-mails about a failed or missing
-- payment, so someone at the company can follow up.
CREATE TABLE IF NOT EXISTS "empresa_contatos_erp" (
	"hubspot_empresa_id" text PRIMARY KEY NOT NULL,
	"email_sac" text,
	"atualizado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A user's own marks on products: favourites and "save for later". Per user, so one person's list doesn't
-- change anyone else's.
CREATE TABLE IF NOT EXISTS "produto_marcacoes" (
	"usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
	"produto_id" uuid NOT NULL REFERENCES "produtos"("id") ON DELETE CASCADE,
	"tipo" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produto_marcacoes_pk" PRIMARY KEY ("usuario_id", "produto_id", "tipo"),
	CONSTRAINT "produto_marcacoes_tipo_check" CHECK ("tipo" IN ('favorito', 'depois'))
);
--> statement-breakpoint
-- Copies (CC) and blind copies (CCO) on each cycle's e-mail of a Pagamento mensal.
ALTER TABLE "pagamentos_recorrentes" ADD COLUMN IF NOT EXISTS "cc" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pagamentos_recorrentes" ADD COLUMN IF NOT EXISTS "cco" text[] DEFAULT '{}' NOT NULL;
