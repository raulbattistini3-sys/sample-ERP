# sample-ERP

[English](README.md) · **Português**

ERP de estoque e auditoria: produtos, categorias, usuários e auditorias, com integrações opcionais com Jira / monday.com.

| Pasta | O que é |
| --- | --- |
| `api/` | API REST: Express 5, TypeScript, PostgreSQL (`pg` + drizzle), fila de jobs pg-boss |
| `web/` | Aplicação web: React 18, Vite, Tailwind, TanStack Query |
| `docker/postgres/init/` | SQL que cria o banco do zero: `01_schema.sql` (tabelas, tipos, índices) e `02_seed.sql` (categorias + log de migrations do drizzle) |

Escolha como rodar:

1. [Docker Compose](#1-docker-compose-postgres-puro): o caminho mais rápido. Sobe Postgres, API e web com um comando.
2. [Local com Postgres puro](#2-local-com-postgres-puro): API e web rodam na sua máquina; o Postgres é qualquer instância comum.
3. [Local com Supabase](#3-local-com-supabase): API e web rodam na sua máquina; o banco é um projeto no Supabase.

## Pré-requisitos

- [Git](https://git-scm.com/)
- Opção 1: [Docker](https://docs.docker.com/get-docker/) com Compose v2.24+
- Opções 2 e 3: [Bun](https://bun.sh/) 1.x, [Node.js](https://nodejs.org/) 22+ e `psql` (vem com o [cliente do PostgreSQL](https://www.postgresql.org/download/))

```bash
git clone https://github.com/raulbattistini3-sys/sample-ERP.git
cd sample-ERP
```

## 1. Docker Compose (Postgres puro)

```bash
docker compose up --build
```

| Serviço | Endereço |
| --- | --- |
| Web | http://localhost:8080 |
| API | http://localhost:3333 |
| Postgres | `localhost:5432`, usuário `postgres`, senha `postgres`, banco `sample_erp` |

Na primeira vez que sobe, o Postgres executa os scripts de `docker/postgres/init/`, então o banco já vem com todas as tabelas e as categorias criadas. Os dados ficam no volume `db-data`.

- A porta 5432 já está em uso? Suba com `DB_PORT=5433 docker compose up --build`.
- Configurações opcionais (e-mails pelo Resend, OAuth do Jira / monday.com) são lidas de `api/.env` quando esse arquivo existe. Veja [Variáveis de ambiente](#variáveis-de-ambiente).
- Recomeçar com o banco vazio: `docker compose down -v`. Os scripts de init rodam de novo no próximo `up`.

Depois, [crie o primeiro usuário](#criar-o-primeiro-usuário).

## 2. Local com Postgres puro

### 2.1 Banco de dados

Use qualquer PostgreSQL 17+: uma instalação local, um servidor, ou só o banco do compose (`docker compose up -d db`, que já roda os scripts de init; pule para o 2.2).

Crie o banco e carregue o schema:

```bash
createdb -h localhost -U postgres sample_erp
psql "postgresql://postgres:postgres@localhost:5432/sample_erp" -v ON_ERROR_STOP=1 \
  -f docker/postgres/init/01_schema.sql \
  -f docker/postgres/init/02_seed.sql
```

### 2.2 API

```bash
cd api
cp .env.example .env
bun install
```

Edite `api/.env`:

```dotenv
# sslmode=disable é obrigatório: a API pede SSL por padrão e um Postgres puro não tem TLS
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sample_erp?sslmode=disable
JWT_SECRET=<qualquer texto longo e aleatório>
```

```bash
bun run dev
```

A API sobe em http://localhost:3333 (`PORT` no `.env`).

### 2.3 Web

Em outro terminal:

```bash
cd web
cp .env.example .env    # VITE_API_URL=http://localhost:3333
bun install
bun run dev
```

Abra http://localhost:5173 e [crie o primeiro usuário](#criar-o-primeiro-usuário).

## 3. Local com Supabase

### 3.1 Criar o projeto e carregar o schema

1. Crie um projeto em [supabase.com](https://supabase.com/dashboard) e anote a senha do banco.
2. Em **Connect**, copie a connection string do **Session pooler**. Ela tem este formato: `postgresql://postgres.<project-ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres`.
3. Carregue o schema:

```bash
psql "<connection string do session pooler>" -v ON_ERROR_STOP=1 \
  -f docker/postgres/init/01_schema.sql \
  -f docker/postgres/init/02_seed.sql
```

4. Ative o Row Level Security. O Supabase expõe todas as tabelas de `public` pela Data API, então sem RLS qualquer pessoa com a anon key do projeto consegue lê-las. A API conecta como `postgres`, que ignora o RLS, então isso não a afeta:

```bash
psql "<connection string do session pooler>" -c "
do \$\$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end \$\$;"
```

### 3.2 API e web

Siga o [2.2](#22-api) e o [2.3](#23-web), mas em `api/.env` use a connection string do Supabase **sem** `sslmode=disable`. O Supabase exige SSL, e a API já conecta com ele:

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres
JWT_SECRET=<qualquer texto longo e aleatório>
```

## Criar o primeiro usuário

1. Abra a aplicação web e cadastre-se em `/register`. Contas novas recebem o perfil `Estoque`.
2. Promova essa conta a `SU` (superusuário, que gerencia os admins). A partir de `api/`, com o `DATABASE_URL` do `api/.env` apontando para o banco:

```bash
bun run admin:promote voce@exemplo.com          # SU
bun run admin:promote voce@exemplo.com --role ADM
```

Com o Docker Compose, também dá para fazer pelo `psql`:

```bash
docker compose exec db psql -U postgres -d sample_erp \
  -c "update usuarios set permissoes = 'SU' where lower(email) = lower('voce@exemplo.com')"
```

A API lê o perfil a cada requisição. Saia e entre de novo para a aplicação web também mostrar o novo perfil.

## Variáveis de ambiente

O `api/.env.example` documenta todas as variáveis. Estas são as que importam para rodar o projeto:

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | sim | Connection string do Postgres (adicione `?sslmode=disable` para Postgres sem TLS) |
| `JWT_SECRET` | sim | Assina os tokens de login |
| `PORT` | não | Porta da API (padrão `10000`; o `.env.example` usa `3333`) |
| `APP_HOST` | não | Endereço de bind (padrão `0.0.0.0`; ignorado no Render) |
| `CORS_ORIGINS` | não | Origens web que podem chamar a API, separadas por vírgula (padrão `http://localhost:5173`) |
| `WEB_URL` | não | Endereço da web usado nos links de redefinição de senha |
| `RESEND_API_KEY`, `EMAIL_FROM` | não | E-mails de "Esqueceu a senha?" pelo [Resend](https://resend.com) |
| `INTEGRATIONS_ENCRYPTION_KEY`, `API_PUBLIC_URL`, `JIRA_*`, `MONDAY_*` | não | Integrações com Jira / monday.com |
| `VITE_API_URL` (`web/.env`) | sim | Endereço da API como o navegador a acessa |

## Migrations do banco

O `01_schema.sql` já inclui todas as migrations de `api/drizzle/` (0000-0010), e o `02_seed.sql` as registra no log de migrations do drizzle. Para aplicar migrations adicionadas depois:

```bash
cd api
bun run db:migrate
```

## Scripts úteis

| Onde | Comando | O que faz |
| --- | --- | --- |
| `api/` | `bun run dev` | API com reload ao salvar |
| `api/` | `bun run build` e depois `bun run start` | Build de produção (`dist/`) e start |
| `api/` | `bun run db:migrate` | Aplica as novas migrations SQL de `api/drizzle/` |
| `api/` | `bun run admin:promote <email> [--role SU\|ADM]` | Promove um usuário |
| `web/` | `bun run dev` | Servidor de dev do Vite na :5173 |
| `web/` | `bun run build` | Build de produção (`dist/`) |
