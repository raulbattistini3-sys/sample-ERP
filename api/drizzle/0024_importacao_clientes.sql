-- Client spreadsheets go through the Go importer too (importer/clientes), up to 500,000 rows. They write to
-- HubSpot in batches of 100 for a long time, so the job keeps a checkpoint and a heartbeat instead of
-- holding every result until the end (iniciada_em is renewed with each checkpoint, so DevolverTravadas only takes
-- back a job that stopped moving):
--   tipo                which processor takes the job; the API's own fallback worker only takes 'produtos'
--   linhas_processadas  rows done so far, committed after each batch; a resumed job starts after them
--   linhas_falharam     rows with an error (their errors are in importacao_erros)
--   empresas_criadas    companies created in HubSpot because a row named one it didn't have
ALTER TABLE "importacoes" ADD COLUMN IF NOT EXISTS "tipo" text DEFAULT 'produtos' NOT NULL;
--> statement-breakpoint
ALTER TABLE "importacoes" DROP CONSTRAINT IF EXISTS "importacoes_tipo_check";
--> statement-breakpoint
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_tipo_check" CHECK ("tipo" IN ('produtos', 'clientes'));
--> statement-breakpoint
ALTER TABLE "importacoes" ADD COLUMN IF NOT EXISTS "linhas_processadas" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "importacoes" ADD COLUMN IF NOT EXISTS "linhas_falharam" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "importacoes" ADD COLUMN IF NOT EXISTS "empresas_criadas" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- One row per problem, in the order they were found. seq is what a client pages by: it asks only for the
-- errors after the last one it already shows, so a screen that has 2,000 errors on it fetches just the new ones.
CREATE TABLE IF NOT EXISTS "importacao_erros" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"importacao_id" uuid NOT NULL REFERENCES "importacoes"("id") ON DELETE CASCADE,
	"linha" integer NOT NULL,
	"campo" text,
	"email" text,
	"mensagem" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "importacao_erros_importacao_seq_idx" ON "importacao_erros" ("importacao_id", "seq");
