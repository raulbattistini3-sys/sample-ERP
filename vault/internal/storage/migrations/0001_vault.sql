-- The vault's own database: nothing here references the ERP's tables. owner_type + owner_id is a
-- logical link to the ERP row the data belongs to (owner_type 'usuario', owner_id = usuarios.id).

CREATE TABLE IF NOT EXISTS vault_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type  varchar(50) NOT NULL,
  owner_id    varchar(64) NOT NULL,
  -- the record's JSON, AES-256-GCM under its own data key; the 16-byte tag is at the end
  ciphertext  bytea NOT NULL,
  nonce       bytea NOT NULL,
  -- the data key, AES-256-GCM under KEK version kek_version (VAULT_KEY_DIR)
  wrapped_dek bytea NOT NULL,
  dek_nonce   bytea NOT NULL,
  kek_version integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS vault_records_kek_version_idx ON vault_records (kek_version);

-- HMAC-SHA-256 of a normalized field (index key in VAULT_KEY_DIR): exact lookups without the value.
-- Unique per owner type and field, so two usuarios can't hold the same CPF.
CREATE TABLE IF NOT EXISTS vault_blind_indexes (
  record_id  uuid NOT NULL REFERENCES vault_records (id) ON DELETE CASCADE,
  owner_type varchar(50) NOT NULL,
  field      varchar(50) NOT NULL,
  digest     bytea NOT NULL,
  PRIMARY KEY (record_id, field),
  UNIQUE (owner_type, field, digest)
);

-- Every write, read and lookup, with who asked; never the data itself.
CREATE TABLE IF NOT EXISTS vault_audit (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  -- the calling service (from its token) and the ERP user it acted for (X-Vault-Actor)
  service    varchar(50) NOT NULL,
  actor      varchar(64),
  action     varchar(30) NOT NULL,
  owner_type varchar(50),
  owner_id   varchar(64),
  outcome    varchar(20) NOT NULL,
  request_id varchar(64)
);

CREATE INDEX IF NOT EXISTS vault_audit_owner_idx ON vault_audit (owner_type, owner_id, at);
