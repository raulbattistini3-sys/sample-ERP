-- Automatic auditorias are no longer created on the change's own transaction: the change is queued here
-- (same transaction, so it's never lost) and AuditoriaConsolidacaoWorker turns the queue into auditorias
-- every few minutes (AUDITORIAS_INTERVALO_MINUTOS, default 5). One sweep makes one lote per user and
-- action: all of a user's single edits in the window together ("edicao"), each bulk action on its own
-- ("lote:<uuid>": inactivating many products, changing many prices or quantities), and a categoria's
-- changes per categoria. The integrations then get one issue/ticket per categoria summing the lote up.
-- A product edited several times in the window becomes one auditoria (first "antes", last "depois").
-- A change a manual auditoria covers still claims it right away and never comes here.
CREATE TABLE IF NOT EXISTS "alteracoes_pendentes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
	"grupo" text NOT NULL,
	"produto_id" uuid REFERENCES "produtos"("id") ON DELETE CASCADE,
	"categoria_id" uuid REFERENCES "categorias"("id") ON DELETE CASCADE,
	"nome" text NOT NULL,
	"venda_antes" numeric(12, 2) NOT NULL DEFAULT 0,
	"venda_depois" numeric(12, 2) NOT NULL DEFAULT 0,
	"alteracoes" jsonb NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alteracoes_pendentes_alvo_check" CHECK (("produto_id" IS NULL) <> ("categoria_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alteracoes_pendentes_criada_em_idx" ON "alteracoes_pendentes" ("criada_em");
--> statement-breakpoint
-- Things sent to outside services that must happen once per key, whatever retries or backfills run:
-- HubSpot timeline notes for cobranças and payments (canal 'hubspot'), WhatsApp messages (canal
-- 'whatsapp'). The row is written before the call and removed if the call fails, so a crash between
-- the two errs on the side of not sending twice.
CREATE TABLE IF NOT EXISTS "envios_externos" (
	"chave" text PRIMARY KEY NOT NULL,
	"canal" text NOT NULL,
	"referencia" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envios_externos_canal_check" CHECK ("canal" IN ('hubspot', 'whatsapp'))
);
