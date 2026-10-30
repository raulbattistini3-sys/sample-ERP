-- HubSpot replaces monday.com. The enum keeps 'monday' (Postgres can't drop a value, and sent rows keep
-- their history); the connection, with its stored tokens, goes, and rows still waiting are cancelled.
ALTER TYPE "integracao_provider" ADD VALUE IF NOT EXISTS 'hubspot';
--> statement-breakpoint
DELETE FROM "integracoes" WHERE "provider" = 'monday';
--> statement-breakpoint
UPDATE "auditoria_integracao_envios" SET "status" = 'cancelada'
WHERE "provider" = 'monday' AND "status" IN ('pendente', 'publicada', 'enviando', 'erro');
