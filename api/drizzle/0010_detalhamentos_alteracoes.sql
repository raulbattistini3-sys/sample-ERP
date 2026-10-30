-- Every field an auditoria changed, as [{ "campo": "Nome", "antes": "...", "depois": "..." }]. Manual
-- auditorias now apply their changes to the product/categoria, so they can touch any field, not only
-- the valor de venda kept in valor_anterior/valor_atual. Existing rows start with an empty list.
ALTER TABLE "detalhamentos_auditoria" ADD COLUMN IF NOT EXISTS "alteracoes" jsonb NOT NULL DEFAULT '[]'::jsonb;
