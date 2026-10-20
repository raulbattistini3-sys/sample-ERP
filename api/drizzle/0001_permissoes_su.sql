-- SU (superusuário): every ADM right, plus managing ADM/SU accounts (only an SU can create, promote to,
-- demote, archive or delete an ADM or SU). The API keeps at least one active SU at all times; the
-- recovery script (bun run admin:promote <email>) grants SU directly through the database.
-- No existing usuario is changed here.
ALTER TYPE "permissoes_usuario" ADD VALUE IF NOT EXISTS 'SU';
