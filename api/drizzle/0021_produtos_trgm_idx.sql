-- Trigram indexes for the product search box, which the server answers while the browser's local engine
-- is still building its own indexes (and always, before the snapshot arrives):
--
--   SKU   `sku ILIKE '%…%'` (any part of it). The unique btree on sku (produtos_sku_key) answers equality
--         only, so a selective search walked produtos_name_id_idx until it had a page: 4.4 s for
--         '%LT-00123%' on 600k rows.
--   name  `name ~* '(^|[^[:alnum:]])word'` per word (every word typed starts a word of the name). Same
--         walk: 1.0-1.5 s for a word few names have.
--
-- A trigram GIN index answers both (pg_trgm handles ILIKE and regular expressions) for words of 3+
-- characters. Shorter ones match most rows, and the name-order walk finds a page at once.
--
-- pg_trgm goes in the `extensions` schema, Supabase's convention (uuid-ossp and pgcrypto live there).
-- If it is already installed elsewhere (a local Postgres), IF NOT EXISTS keeps it there, so the operator
-- class is looked up wherever it is instead of assumed.
--
-- Plain CREATE INDEX, not CONCURRENTLY: drizzle-kit runs migrations in a transaction. It blocks writes to
-- produtos (not reads) while it builds, some seconds at 600k rows.
CREATE SCHEMA IF NOT EXISTS "extensions";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";
--> statement-breakpoint
DO $$
DECLARE
	opclass_schema text;
BEGIN
	SELECT n.nspname INTO opclass_schema
	FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace JOIN pg_am a ON a.oid = o.opcmethod
	WHERE o.opcname = 'gin_trgm_ops' AND a.amname = 'gin';

	EXECUTE format('CREATE INDEX IF NOT EXISTS "produtos_sku_trgm_idx" ON "produtos" USING gin ("sku" %I.gin_trgm_ops)', opclass_schema);
	EXECUTE format('CREATE INDEX IF NOT EXISTS "produtos_name_trgm_idx" ON "produtos" USING gin ("name" %I.gin_trgm_ops)', opclass_schema);
END $$;
