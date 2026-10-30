-- Rows the API needs on a fresh database. Users sign up through POST /user/register; promote the
-- first one with: docker compose exec db psql -U postgres -d sample_erp -c "update usuarios set permissoes = 'SU' where lower(email) = lower('you@example.com')"

-- the 10 categorias (one per categorias_nomes value), same as production
INSERT INTO public.categorias (nome, tipo, ativo) VALUES
  ('CASA', 'Normal', true),
  ('CELULARES', 'Normal', true),
  ('COMERCIO & SEGURANCA', 'Especial', true),
  ('ELETRODOMESTICOS', 'Normal', true),
  ('ELETRONICOS', 'Normal', true),
  ('ESPORTE E SAUDE', 'Normal', true),
  ('INFORMATICA', 'Normal', true),
  ('LAZER E ENTRETENIMENTO', 'Normal', true),
  ('MERCADO', 'Normal', true),
  ('MODA', 'Especial', true);

-- drizzle-kit's migration log: 01_schema.sql already contains api/drizzle 0000-0013, so
-- `bun run db:migrate` against this database only applies migrations added after them
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('cca0db81efc947fe545067801f36d6fa64ae4997250fd365b82b1ca1126701ac', 1792508911324),
  ('69678dba8fc4ab3824880b046fbeddae77bb8ffc777510280256d20c8f60e109', 1792510159163),
  ('daed4b0e91d17b2d2ea72f221a77d500d1bda0884acb16fa998f1d907843ef61', 1792511157548),
  ('714d6217eed59c1c2ba999b79693f1001c8a9cc42d5a61ce50f65a5af0e71e29', 1792512316260),
  ('6b8e763050dbd048412e8380b1069ebf42b484f0cbf1b343d92b933f3f4a1720', 1792517990593),
  ('02eb750c101a2e3221c171e55f0ead3f0de2243099f067a799ddaabe4ffcd1aa', 1792520119399),
  ('5b27707ed76f37e1b826592c9e7b688fd6e859abb929c76f0a39374fa5bdd96f', 1792522881083),
  ('49033ed6339c84a3b6a8e43449fbde92eebdbcda65e3890700fd08f5f931d4b8', 1792523944972),
  ('5400121cd312347580a266f7535e99e285a1b021aa0d97bd9893089423eb02dd', 1792524965529),
  ('821b7f84459477b3a9babec4fce76b89851c01a266d2f87ced102451463344b5', 1792530822121),
  ('70828f51f8ee6022ef602fe8d22b04f76f9e86bf727edb5a91b2604aebc9c3ff', 1792540822121),
  ('b287a2241b3f809d7a4363294b94dd2a12403eee153519840b1c7196c5f6b3a3', 1792550822121),
  ('220512e86388932a664e23b5b1793809142fe251b80ec9499c6a7d2873cb0e9f', 1792560822121),
  ('e71e0dd2e784a318016e749bd703d654c4efb6af5e4797a3d40d619600b9e3e3', 1792570822121);
