-- Every login token carries the usuario's sessao_versao (claim "ver"). Changing the senha
-- (forgot-password reset, or an admin setting a new one) increments it, and AuthMiddleware rejects
-- tokens whose "ver" no longer matches, which ends every session opened before the change.
-- Existing usuarios start at 0, the same value assumed for tokens issued before this column existed.
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "sessao_versao" integer NOT NULL DEFAULT 0;
