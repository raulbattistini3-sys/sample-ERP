-- Automatic "Alteracao" auditorias for product/categoria changes, unless a manual one already covers it.
-- criada_em: when the auditoria row was created (data_de_audicao is user-supplied and can be any date).
--   Added without a default first so existing rows stay NULL and never count as "recent"; new rows get now().
-- vinculada_em: when the auditoria was tied to a change. A manual auditoria covers at most one change,
--   and automatic ones are created already tied, so neither can cover a later change.
ALTER TABLE "auditorias" ADD COLUMN IF NOT EXISTS "criada_em" timestamptz;
--> statement-breakpoint
ALTER TABLE "auditorias" ALTER COLUMN "criada_em" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "auditorias" ADD COLUMN IF NOT EXISTS "vinculada_em" timestamptz;
