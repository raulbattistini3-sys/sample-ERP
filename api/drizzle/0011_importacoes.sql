-- Spreadsheet imports run by the Go importer (importer/, proto/importador/v1). The table is also its job
-- queue: a 'pendente' row is a queued job, claimed with FOR UPDATE SKIP LOCKED so two workers never take
-- the same one; a 'processando' row whose iniciada_em is too old belongs to a crashed worker and goes
-- back to 'pendente'. erros is [{ "linha": 3, "campo": "sku", "mensagem": "..." }].
--
-- The uploaded .xlsx lives in the row itself (planilha), so the database is both queue and storage and
-- any importer instance can process any job with nothing but DATABASE_URL. It is cleared once the import
-- finishes. In production the bytes belong in object storage (S3, or Supabase Storage, which speaks the
-- S3 API) with only the object key here; see importer/storage/storage.go:
--   "chave_arquivo" text NOT NULL,
CREATE TABLE IF NOT EXISTS "importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL REFERENCES "usuarios"("id"),
	"nome_arquivo" text NOT NULL,
	"planilha" bytea,
	"status" text DEFAULT 'pendente' NOT NULL,
	"total_linhas" integer DEFAULT 0 NOT NULL,
	"linhas_importadas" integer DEFAULT 0 NOT NULL,
	"erros" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mensagem" text,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciada_em" timestamp with time zone,
	"finalizada_em" timestamp with time zone,
	CONSTRAINT "importacoes_status_check" CHECK ("status" IN ('pendente', 'processando', 'concluida', 'rejeitada', 'falhou'))
);
--> statement-breakpoint
-- the claim query: oldest pending first
CREATE INDEX IF NOT EXISTS "importacoes_pendentes_idx" ON "importacoes" ("criada_em") WHERE "status" = 'pendente';
--> statement-breakpoint
-- the stuck-job sweep
CREATE INDEX IF NOT EXISTS "importacoes_processando_idx" ON "importacoes" ("iniciada_em") WHERE "status" = 'processando';
