-- One row per "forgot password" link. Only the SHA-256 of the token is stored, so a leaked table
-- can't be used to reset anyone's password. timestamptz + now() keep expiry independent of the
-- API server's timezone.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_usuario_id_idx" ON "password_reset_tokens" ("usuario_id");
