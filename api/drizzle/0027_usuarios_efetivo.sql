-- efetivo: a permanent employee. The usuario's cpf and data_nascimento are not columns: they are kept,
-- encrypted, in the vault (vault/), under owner_type 'usuario' and owner_id = usuarios.id.
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "efetivo" boolean NOT NULL DEFAULT false;
