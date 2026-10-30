-- The product scroll walks (name, id) with keyset pagination.
CREATE INDEX IF NOT EXISTS "produtos_name_id_idx" ON "produtos" ("name", "id");
