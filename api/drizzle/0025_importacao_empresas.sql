-- Company spreadsheets go through the Go importer too (importer/importacao/empresas.go), like clients:
-- written to HubSpot in batches, with the same checkpoint, counters and importacao_erros (whose "email"
-- holds the company's name for these).
ALTER TABLE "importacoes" DROP CONSTRAINT IF EXISTS "importacoes_tipo_check";
--> statement-breakpoint
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_tipo_check" CHECK ("tipo" IN ('produtos', 'clientes', 'empresas'));
