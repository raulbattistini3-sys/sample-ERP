#!/bin/sh
# Extensions of the "profiling" database (created by 00_extensions.sql). Missing ones are skipped.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname profiling <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.ext(name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I CASCADE', name);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'extension % skipped: %', name, SQLERRM;
END $$;
SELECT pg_temp.ext(e) FROM unnest(ARRAY[
  'pg_stat_statements', 'uuid-ossp', 'pgcrypto', 'supabase_vault', 'hypopg', 'index_advisor',
  'btree_gin', 'pg_trgm', 'fuzzystrmatch', 'btree_gist', 'vector'
]) AS e;
SQL
