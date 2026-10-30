-- How many rows of a concluded import created products and how many updated existing ones (linhas_importadas
-- is their sum), so the web can report the same "N criado(s), M atualizado(s)" as POST /products/import.
ALTER TABLE "importacoes" ADD COLUMN IF NOT EXISTS "linhas_criadas" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "importacoes" ADD COLUMN IF NOT EXISTS "linhas_atualizadas" integer DEFAULT 0 NOT NULL;
