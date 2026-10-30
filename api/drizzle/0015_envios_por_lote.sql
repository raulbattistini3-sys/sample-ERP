-- A bulk change (a spreadsheet import) is one lote: its automatic auditorias share lote_id, and each
-- integration gets one issue/ticket per categoria summing them up instead of one per product. The envio
-- hangs off one of the lote's auditorias; resumo holds the counts ({ total, aumentos, reducoes, icms,
-- outras }) and stays NULL when the categoria had a single change, which keeps the detailed issue.
ALTER TABLE "auditorias" ADD COLUMN IF NOT EXISTS "lote_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditorias_lote_idx" ON "auditorias" ("lote_id") WHERE "lote_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" ADD COLUMN IF NOT EXISTS "lote_id" uuid;
--> statement-breakpoint
ALTER TABLE "auditoria_integracao_envios" ADD COLUMN IF NOT EXISTS "resumo" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditoria_integracao_envios_lote_idx" ON "auditoria_integracao_envios" ("lote_id") WHERE "lote_id" IS NOT NULL;
