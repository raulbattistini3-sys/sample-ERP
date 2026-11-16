-- Runs once, on an empty vault-data volume (vault-db, database sample_erp_vault).
-- The vault's tables come from its own migrations (vault/internal/storage/migrations); these are
-- the extensions they can use. pgcrypto/pgsodium are for in-database crypto (digests, gen_random_bytes,
-- crypto_aead_*); the vault's records are already AES-256-GCM ciphertext encrypted by the vault process
-- with keys kept outside the database, so the columns aren't encrypted a second time.
-- btree_gin: GIN indexes over plain scalars (combined with jsonb/array keys); ordinary B-tree needs nothing.

CREATE OR REPLACE FUNCTION pg_temp.ext(name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I CASCADE', name);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'extension % skipped: %', name, SQLERRM;
END $$;

SELECT pg_temp.ext(e) FROM unnest(ARRAY[
  'pg_stat_statements', 'pgcrypto', 'pgsodium', 'btree_gin'
]) AS e;
