-- Base schema of the API (public), dumped schema-only from the Supabase database with every
-- migration in api/drizzle applied (0000-0010). The postgres image runs this once, on an empty volume.
-- Supabase-only parts were removed: the vault helper functions and row level security.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: acao_efetuada; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.acao_efetuada AS ENUM (
    'Criacao',
    'Alteracao',
    'Delecao'
);

--
-- Name: categorias_nomes; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.categorias_nomes AS ENUM (
    'ELETRONICOS',
    'INFORMATICA',
    'ELETRODOMESTICOS',
    'CELULARES',
    'MERCADO',
    'CASA',
    'COMERCIO & SEGURANCA',
    'LAZER E ENTRETENIMENTO',
    'MODA',
    'ESPORTE E SAUDE'
);

--
-- Name: categorias_tipos; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.categorias_tipos AS ENUM (
    'Normal',
    'Especial',
    'Personalizado'
);

--
-- Name: integracao_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integracao_provider AS ENUM (
    'jira',
    'hubspot'
);

--
-- Name: permissoes_usuario; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.permissoes_usuario AS ENUM (
    'ADM',
    'Estoque',
    'SU'
);

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auditoria_integracao_envios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_integracao_envios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auditoria_id uuid NOT NULL,
    categoria_id uuid NOT NULL,
    categoria_nome text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    external_id text,
    external_url text,
    tentativas integer DEFAULT 0 NOT NULL,
    ultimo_erro text,
    proxima_tentativa_em timestamp with time zone DEFAULT now() NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    enviado_em timestamp with time zone,
    job_id uuid,
    provider public.integracao_provider NOT NULL,
    lote_id uuid,
    resumo jsonb,
    CONSTRAINT auditoria_integracao_envios_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'publicada'::text, 'enviando'::text, 'enviada'::text, 'erro'::text, 'cancelada'::text])))
);

--
-- Name: auditorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditorias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    acao_efetuada public.acao_efetuada NOT NULL,
    data_de_audicao timestamp without time zone NOT NULL,
    usuario_id uuid NOT NULL,
    detalhamento_auditoria_id uuid,
    deleted_at timestamp without time zone,
    criada_em timestamp with time zone DEFAULT now(),
    vinculada_em timestamp with time zone,
    lote_id uuid
);

--
-- Name: categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome public.categorias_nomes NOT NULL,
    ativo boolean NOT NULL,
    tipo public.categorias_tipos NOT NULL
);

--
-- Name: detalhamentos_auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalhamentos_auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome_do_produto text NOT NULL,
    valor_anterior numeric NOT NULL,
    valor_atual numeric NOT NULL,
    observacoes_adicionais text NOT NULL,
    deleted_at timestamp without time zone,
    alteracoes jsonb DEFAULT '[]'::jsonb NOT NULL
);

--
-- Name: integracoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integracoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.integracao_provider NOT NULL,
    access_token_cifrado text NOT NULL,
    refresh_token_cifrado text,
    expira_em timestamp with time zone,
    escopos text DEFAULT ''::text NOT NULL,
    conta_externa jsonb DEFAULT '{}'::jsonb NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    conectado_por uuid,
    conectado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: oauth_estados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_estados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.integracao_provider NOT NULL,
    estado_hash text NOT NULL,
    usuario_id uuid NOT NULL,
    expira_em timestamp with time zone NOT NULL,
    usado_em timestamp with time zone
);

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: produtos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produtos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    ativo boolean NOT NULL,
    sku text NOT NULL,
    categoria_id uuid NOT NULL,
    valor_de_custo numeric(10,2) NOT NULL,
    icms double precision NOT NULL,
    valor_de_venda numeric(10,2) NOT NULL,
    data_de_cadastro timestamp without time zone NOT NULL,
    quantidade_em_estoque double precision NOT NULL
);

--
-- Name: produtos_por_auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produtos_por_auditoria (
    auditoria_id uuid NOT NULL,
    produto_id uuid NOT NULL
);

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    permissoes public.permissoes_usuario NOT NULL,
    email text NOT NULL,
    senha text NOT NULL,
    ativo boolean NOT NULL,
    sessao_versao integer DEFAULT 0 NOT NULL
);

--
-- Name: auditoria_integracao_envios auditoria_integracao_envios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_integracao_envios
    ADD CONSTRAINT auditoria_integracao_envios_pkey PRIMARY KEY (id);

--
-- Name: auditoria_integracao_envios auditoria_integracao_envios_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_integracao_envios
    ADD CONSTRAINT auditoria_integracao_envios_unico UNIQUE (auditoria_id, categoria_id, provider);

--
-- Name: auditorias auditorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditorias
    ADD CONSTRAINT auditorias_pkey PRIMARY KEY (id);

--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);

--
-- Name: detalhamentos_auditoria detalhamentos_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalhamentos_auditoria
    ADD CONSTRAINT detalhamentos_auditoria_pkey PRIMARY KEY (id);

--
-- Name: integracoes integracoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integracoes
    ADD CONSTRAINT integracoes_pkey PRIMARY KEY (id);

--
-- Name: integracoes integracoes_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integracoes
    ADD CONSTRAINT integracoes_provider_key UNIQUE (provider);

--
-- Name: oauth_estados oauth_estados_estado_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_estados
    ADD CONSTRAINT oauth_estados_estado_hash_key UNIQUE (estado_hash);

--
-- Name: oauth_estados oauth_estados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_estados
    ADD CONSTRAINT oauth_estados_pkey PRIMARY KEY (id);

--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);

--
-- Name: produtos produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pkey PRIMARY KEY (id);

--
-- Name: produtos_por_auditoria produtos_por_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos_por_auditoria
    ADD CONSTRAINT produtos_por_auditoria_pkey PRIMARY KEY (auditoria_id, produto_id);

--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

--
-- Name: auditoria_integracao_envios_sem_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auditoria_integracao_envios_sem_job_idx ON public.auditoria_integracao_envios USING btree (criado_em) WHERE ((status = 'pendente'::text) AND (job_id IS NULL));

--
-- Name: password_reset_tokens_usuario_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_usuario_id_idx ON public.password_reset_tokens USING btree (usuario_id);

--
-- Name: usuarios_email_lower_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usuarios_email_lower_unique ON public.usuarios USING btree (lower(email));

--
-- Name: auditoria_integracao_envios auditoria_integracao_envios_auditoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_integracao_envios
    ADD CONSTRAINT auditoria_integracao_envios_auditoria_id_fkey FOREIGN KEY (auditoria_id) REFERENCES public.auditorias(id) ON DELETE CASCADE;

--
-- Name: auditorias auditorias_detalhamento_auditoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditorias
    ADD CONSTRAINT auditorias_detalhamento_auditoria_id_fkey FOREIGN KEY (detalhamento_auditoria_id) REFERENCES public.detalhamentos_auditoria(id);

--
-- Name: auditorias auditorias_nome_do_auditor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditorias
    ADD CONSTRAINT auditorias_nome_do_auditor_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);

--
-- Name: integracoes integracoes_conectado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integracoes
    ADD CONSTRAINT integracoes_conectado_por_fkey FOREIGN KEY (conectado_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;

--
-- Name: oauth_estados oauth_estados_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_estados
    ADD CONSTRAINT oauth_estados_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

--
-- Name: password_reset_tokens password_reset_tokens_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

--
-- Name: produtos produtos_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorias(id);

--
-- Name: produtos_por_auditoria produtos_por_auditoria_auditoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos_por_auditoria
    ADD CONSTRAINT produtos_por_auditoria_auditoria_id_fkey FOREIGN KEY (auditoria_id) REFERENCES public.auditorias(id);

--
-- Name: produtos_por_auditoria produtos_por_auditoria_produto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos_por_auditoria
    ADD CONSTRAINT produtos_por_auditoria_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id);

--
-- api/drizzle/0011_importacoes.sql
--

-- Spreadsheet imports run by the Go importer (importer/, proto/importador/v1). The table is also its job
-- queue: a 'pendente' row is a queued job, claimed with FOR UPDATE SKIP LOCKED so two workers never take
-- the same one; a 'processando' row whose iniciada_em is too old belongs to a crashed worker and goes
-- back to 'pendente'. erros is [{ "linha": 3, "campo": "sku", "mensagem": "..." }].
--
-- The uploaded .xlsx lives in the row itself (planilha), so the database is both queue and storage and
-- any importer instance can process any job with nothing but DATABASE_URL. It is cleared once the import
-- finishes. In production the bytes belong in object storage (S3, or Supabase Storage, which speaks the
-- S3 API) with only the object key here; see importer/storage/storage.go:
--   "chave_arquivo" text NOT NULL,
CREATE TABLE IF NOT EXISTS public."importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL REFERENCES public."usuarios"("id"),
	"nome_arquivo" text NOT NULL,
	"planilha" bytea,
	"status" text DEFAULT 'pendente' NOT NULL,
	"total_linhas" integer DEFAULT 0 NOT NULL,
	"linhas_importadas" integer DEFAULT 0 NOT NULL,
	"erros" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mensagem" text,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciada_em" timestamp with time zone,
	"finalizada_em" timestamp with time zone,
	CONSTRAINT "importacoes_status_check" CHECK ("status" IN ('pendente', 'processando', 'concluida', 'rejeitada', 'falhou'))
);
--> statement-breakpoint
-- the claim query: oldest pending first
CREATE INDEX IF NOT EXISTS "importacoes_pendentes_idx" ON public."importacoes" ("criada_em") WHERE "status" = 'pendente';
--> statement-breakpoint
-- the stuck-job sweep
CREATE INDEX IF NOT EXISTS "importacoes_processando_idx" ON public."importacoes" ("iniciada_em") WHERE "status" = 'processando';

--
-- api/drizzle/0012_produtos_sku_unique.sql
--

-- A SKU identifies one product, active or not: imports already match rows to products by exact SKU and
-- reactivate inactive ones, and two imports (API or importer/) running at once could otherwise both insert
-- the same SKU. Existing duplicates stop the migration with the list, since picking which product survives
-- (auditorias point at them) is a decision for a person, not a migration.
DO $$
DECLARE
	duplicados text;
BEGIN
	SELECT string_agg(format('%s (%s produtos)', sku, total), ', ')
	INTO duplicados
	FROM (SELECT "sku", count(*) AS total FROM public."produtos" GROUP BY "sku" HAVING count(*) > 1) d;

	IF duplicados IS NOT NULL THEN
		RAISE EXCEPTION 'SKUs repetidos em produtos: %. Altere ou remova os repetidos e rode a migration de novo.', duplicados;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public."produtos" ADD CONSTRAINT "produtos_sku_key" UNIQUE ("sku");

--
-- api/drizzle/0013_importacoes_contagens.sql
--

-- How many rows of a concluded import created products and how many updated existing ones (linhas_importadas
-- is their sum), so the web can report the same "N criado(s), M atualizado(s)" as POST /products/import.
ALTER TABLE public."importacoes" ADD COLUMN IF NOT EXISTS "linhas_criadas" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE public."importacoes" ADD COLUMN IF NOT EXISTS "linhas_atualizadas" integer DEFAULT 0 NOT NULL;

-- api/drizzle/0015_envios_por_lote.sql (columns above)
CREATE INDEX IF NOT EXISTS "auditorias_lote_idx" ON public."auditorias" ("lote_id") WHERE "lote_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "auditoria_integracao_envios_lote_idx" ON public."auditoria_integracao_envios" ("lote_id") WHERE "lote_id" IS NOT NULL;

-- api/drizzle/0016_clientes.sql
CREATE TABLE IF NOT EXISTS public."clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hubspot_id" text NOT NULL UNIQUE,
	"nome" text NOT NULL,
	"email" text,
	"telefone" text,
	"empresa" text,
	"estagio" text,
	"url" text,
	"criado_no_hubspot_em" timestamp with time zone,
	"atualizado_no_hubspot_em" timestamp with time zone,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "clientes_nome_idx" ON public."clientes" (lower("nome"));


-- api/drizzle/0017_empresas.sql
CREATE TABLE IF NOT EXISTS public."empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hubspot_id" text NOT NULL UNIQUE,
	"nome" text NOT NULL,
	"dominio" text,
	"setor" text,
	"url" text,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "empresas_nome_idx" ON public."empresas" (lower("nome"));
ALTER TABLE public."clientes" ADD COLUMN IF NOT EXISTS "cargo" text;
ALTER TABLE public."clientes" ADD COLUMN IF NOT EXISTS "senioridade" text;
ALTER TABLE public."clientes" ADD COLUMN IF NOT EXISTS "papeis" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE public."clientes" ADD COLUMN IF NOT EXISTS "empresas_hubspot_ids" text[] DEFAULT '{}' NOT NULL;
CREATE INDEX IF NOT EXISTS "clientes_empresas_idx" ON public."clientes" USING gin ("empresas_hubspot_ids");
