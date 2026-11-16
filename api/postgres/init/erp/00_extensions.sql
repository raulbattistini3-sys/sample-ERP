-- Runs once, on an empty db-data volume, before docker/postgres/init (schema + seed).
-- Extensions of sample_erp, plus the "profiling" database and its extensions.
-- An extension the image doesn't have is skipped with a WARNING instead of failing the init.

CREATE OR REPLACE FUNCTION pg_temp.ext(name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I CASCADE', name);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'extension % skipped: %', name, SQLERRM;
END $$;

-- sample_erp
SELECT pg_temp.ext(e) FROM unnest(ARRAY[
  'pg_stat_statements', 'uuid-ossp', 'pgcrypto', 'pgsodium', 'supabase_vault', 'pg_graphql',
  'pg_trgm', 'fuzzystrmatch', 'pg_prewarm', 'btree_gin'
]) AS e;

CREATE DATABASE profiling;
