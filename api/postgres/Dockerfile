# Postgres 17 with the extensions the ERP, profiling and vault databases use (api/postgres/init).
# postgres:17-bookworm already has the PGDG apt repo: hypopg and pgvector come from there; pgsodium,
# supabase_vault and index_advisor aren't packaged, so they're built from source.
# pg_graphql (Rust/pgrx, a long build) is left out: the init scripts skip any extension that's missing.
FROM postgres:17-bookworm

ARG PGSODIUM_VERSION=v3.1.9
ARG SUPABASE_VAULT_VERSION=v0.3.1
ARG INDEX_ADVISOR_VERSION=v0.2.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      postgresql-17-hypopg postgresql-17-pgvector \
      build-essential git ca-certificates libsodium-dev libsodium23 postgresql-server-dev-17; \
    cd /tmp; \
    git clone --depth 1 --branch "$PGSODIUM_VERSION" https://github.com/michelp/pgsodium.git; \
    make -C pgsodium install; \
    git clone --depth 1 --branch "$SUPABASE_VAULT_VERSION" https://github.com/supabase/vault.git; \
    make -C vault install; \
    git clone --depth 1 --branch "$INDEX_ADVISOR_VERSION" https://github.com/supabase/index_advisor.git; \
    make -C index_advisor install; \
    rm -rf /tmp/*; \
    apt-get purge -y build-essential git postgresql-server-dev-17 libsodium-dev; \
    apt-get autoremove -y; rm -rf /var/lib/apt/lists/*
