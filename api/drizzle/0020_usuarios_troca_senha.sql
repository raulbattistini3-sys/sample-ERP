-- An account created with a known password (the BOOTSTRAP_SU_* first superuser) must pick its own
-- before doing anything else; the API refuses every other route while this is true.
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "troca_senha_obrigatoria" boolean DEFAULT false NOT NULL;
