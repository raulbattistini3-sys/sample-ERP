-- Emails identify usuarios at login, so they must be unique regardless of case
-- ("Ana@x.com" and "ana@x.com" are the same person). The existing usuarios_email_key
-- constraint only blocks exact duplicates. Fails if case-insensitive duplicates exist;
-- resolve them first with:
--   select lower(email), count(*) from usuarios group by 1 having count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_email_lower_unique" ON "usuarios" (lower("email"));
