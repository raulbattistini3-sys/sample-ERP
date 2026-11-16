# Postgres images and init scripts

| Database | Where | Extensions |
|---|---|---|
| `sample_erp` | `db` (docker) / Supabase (dev) | pg_stat_statements, uuid-ossp, pgcrypto, pgsodium, supabase_vault, pg_graphql¹, pg_trgm, fuzzystrmatch, pg_prewarm, btree_gin |
| `profiling` | `db` (docker), created by `init/erp/00_extensions.sql` | pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault, hypopg, index_advisor, btree_gin, pg_trgm, fuzzystrmatch, btree_gist, vector |
| `sample_erp_vault` | `vault-db` (its own instance) / launcher embedded Postgres :5433 (dev) | pg_stat_statements, pgcrypto, pgsodium, btree_gin |

¹ not built into the image (Rust/pgrx); skipped with a WARNING. Every missing extension is skipped, not fatal.

`Dockerfile` = `postgres:17-bookworm` + hypopg, pgvector (apt) + pgsodium, supabase_vault, index_advisor
(source). Init scripts only run on an **empty** volume; for existing volumes run the SQL by hand:

    docker compose exec db psql -U postgres -d sample_erp -f /docker-entrypoint-initdb.d/00_extensions.sql
    docker compose exec vault-db psql -U vault -d sample_erp_vault -f /docker-entrypoint-initdb.d/00_extensions.sql

## Dev (psql -U postgres)

The vault's columns are already AES-256-GCM ciphertext made by the vault process with keys in
`secrets/vault/` — the keys never enter Postgres, which is the point. pgcrypto/pgsodium are installed
for in-database helpers, not to re-encrypt those columns (that would put a key inside the database).

Launcher's embedded Postgres (password = `POSTGRES_PASSWORD` in `bin/data`, launcher must be running):

    psql -U postgres -h 127.0.0.1 -p 5433 -d sample_erp_vault -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gin; CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
    psql -U postgres -h 127.0.0.1 -p 5433 -c "CREATE DATABASE profiling"
    psql -U postgres -h 127.0.0.1 -p 5433 -d profiling -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS fuzzystrmatch; CREATE EXTENSION IF NOT EXISTS btree_gin; CREATE EXTENSION IF NOT EXISTS btree_gist;"

pgsodium, supabase_vault, hypopg, index_advisor and vector aren't in the embedded binaries (contrib
only): `CREATE EXTENSION pgsodium` fails there with "could not open extension control file". Use the
docker `vault-db` for them. pg_stat_statements also needs `shared_preload_libraries` to collect data.

Supabase (`sample_erp`): enable from the dashboard (Database → Extensions) or
`create extension if not exists pg_prewarm with schema extensions;` — pgsodium is deprecated there.

Use in SQL, e.g. `select encode(digest('x','sha256'),'hex');` (pgcrypto),
`select pgsodium.crypto_aead_det_encrypt(...)` (pgsodium).
