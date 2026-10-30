# sample-ERP

[English](README.md) · **Português**

ERP de estoque e auditoria: produtos, categorias, usuários e auditorias, com integrações opcionais com Jira / HubSpot.

| Pasta | O que é |
| --- | --- |
| `api/` | API REST: Express 5, TypeScript, PostgreSQL (`pg` + drizzle), fila de jobs pg-boss |
| `web/` | Aplicação web: React 18, Vite, Tailwind, TanStack Query |
| `importer/` | Importador de planilhas: Go, gRPC. Lê planilhas de produtos `.xlsx`/`.csv` e as salva em segundo plano, com a fila de jobs no Postgres |
| `billing/` | Serviço Stripe: Spring Boot, Java 21. Recebe os webhooks da Stripe e avisa a API sobre faturas pagas e com falha |
| `proto/` | Contrato gRPC entre a API e o importador; o `buf generate` gera o código Go e TypeScript a partir dele |
| `docker/postgres/init/` | SQL que cria o banco do zero: `01_schema.sql` (tabelas, tipos, índices) e `02_seed.sql` (categorias + log de migrations do drizzle) |

Escolha como rodar:

1. [Docker Compose](#1-docker-compose-postgres-puro): o caminho mais rápido. Sobe Postgres, API, importador de planilhas e web com um comando, e o [serviço de billing](#serviço-de-billing-stripe) quando você pedir.
2. [Local com Postgres puro](#2-local-com-postgres-puro): API e web rodam na sua máquina; o Postgres é qualquer instância comum.
3. [Local com Supabase](#3-local-com-supabase): API e web rodam na sua máquina; o banco é um projeto no Supabase.

## Pré-requisitos

- [Git](https://git-scm.com/)
- Opção 1: [Docker](https://docs.docker.com/get-docker/) com Compose v2.24+
- Opções 2 e 3: [Bun](https://bun.sh/) 1.x, [Node.js](https://nodejs.org/) 22+ e `psql` (vem com o [cliente do PostgreSQL](https://www.postgresql.org/download/)); [Go](https://go.dev/dl/) 1.26+ só para o importador de planilhas, que é opcional

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
| Importador (gRPC) | `localhost:50051`, só para ferramentas locais (a API o acessa em `importer:50051`) |
| Billing (opcional) | http://localhost:8081, com `--profile billing` |

Na primeira vez que sobe, o Postgres executa os scripts de `docker/postgres/init/`, então o banco já vem com todas as tabelas e as categorias criadas. Os dados ficam no volume `db-data`.

- A porta 5432 já está em uso? Suba com `DB_PORT=5433 docker compose up --build`.
- Configurações opcionais (e-mails pelo Resend, OAuth do Jira / HubSpot) são lidas de `api/.env` quando esse arquivo existe. Veja [Variáveis de ambiente](#variáveis-de-ambiente).
- Recomeçar com o banco vazio: `docker compose down -v`. Os scripts de init rodam de novo no próximo `up`.
- Os scripts de init só rodam num volume vazio, então a cada `up` o serviço `migrate` (que roda uma vez e termina) aplica as [migrations](#migrations-do-banco) que o banco ainda não tem antes de a API e o importador subirem. Um volume `db-data` de um checkout antigo se atualiza sozinho; se uma migration falhar (por exemplo a 0012 encontrando SKUs repetidos), o log dela diz o motivo e a API e o importador esperam por ela.
- A porta 50051 já está em uso? Suba com `IMPORTER_PORT=50052 docker compose up --build`.
- A porta 8081 já está em uso? Suba o billing com `BILLING_HOST_PORT=8082 docker compose --profile billing up --build`.

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

### 2.4 Importador de planilhas (opcional)

Sem ele, a própria API roda a importação de produtos em segundo plano. Com ele, a API entrega o arquivo enviado ao importador, que faz esse trabalho em um processo próprio. O [`importer/README.md`](importer/README.md) explica como ele funciona, a API gRPC e os limites. Em outro terminal:

```bash
cd importer
cp .env.example .env    # DATABASE_URL: o mesmo do api/.env
go run ./cmd/importer
```

Depois, adicione isto ao `api/.env` e reinicie a API:

```dotenv
IMPORTER_GRPC_URL=localhost:50051
```

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

## Serviço de billing (Stripe)

O `billing/` recebe os webhooks da Stripe. Para uma fatura paga ou com falha, ele salva o evento e um job em segundo plano chama a API, que envia o e-mail pelo Resend:

```text
Stripe -> billing (/webhooks/stripe) -> API (/internal/billing/events) -> Resend
```

O webhook nunca envia e-mail. As tabelas dele ficam num schema `billing` no mesmo banco da API, e o Flyway aplica as migrations **toda vez que o serviço sobe**.

Crie o `billing/.env` a partir do `billing/.env.example`:

| Variável | Para que serve |
| --- | --- |
| `SANDBOX_STRIPE_API_KEY` | Chave de sandbox (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`, impresso pelo `stripe listen` |
| `JDBC_DATABASE_URL` | O banco, com as credenciais na URL. No Supabase use o **session pooler (porta 5432)**: o serviço se recusa a subir no transaction pooler (6543) |
| `ERP_API_URL` | A API, com um IP e não `localhost` |
| `BILLING_INTERNAL_TOKEN` | O mesmo valor do `api/.env`. Sem ele a API responde 401 |

Com Docker, `JDBC_DATABASE_URL`, `ERP_API_URL` e `BILLING_INTERNAL_TOKEN` vêm do `docker-compose.yml`, então só os valores da Stripe importam:

```bash
docker compose --profile billing up --build
```

Sem Docker, defina `BILLING_INTERNAL_TOKEN` também no `api/.env`, reinicie a API (mudanças no `.env` não recarregam sozinhas) e suba o serviço pela pasta dele, que é onde ele procura o `.env`:

```bash
cd billing
./mvnw spring-boot:run
```

Depois encaminhe os eventos da Stripe, na sua máquina nos dois casos:

```bash
npm install -g @stripe/cli
stripe login
stripe listen --thin-events "v1.invoice.paid,v1.invoice.payment_failed" \
  --forward-thin-to localhost:8081/webhooks/stripe \
  --forward-thin-connect-to localhost:8081/webhooks/stripe
stripe trigger invoice.paid --override customer:email=delivered@resend.dev
```

Sem e-mail do cliente, o evento é salvo e nenhuma notificação é criada.

## Hosts e portas

| De | Para | Docker | Na sua máquina |
| --- | --- | --- | --- |
| Navegador | API | `http://localhost:3333` | `VITE_API_URL` |
| API | Importador (gRPC) | `importer:50051` | `IMPORTER_GRPC_URL`, por exemplo `127.0.0.1:50051` |
| API, importador | Postgres | `db:5432` | `DATABASE_URL` |
| Billing | API | `http://api:3333` | `ERP_API_URL`, por exemplo `http://127.0.0.1:3333` |
| Billing | Postgres | `db:5432` | `JDBC_DATABASE_URL` |
| Stripe CLI | Billing | `localhost:8081` | `localhost:8081` |

- Dentro do Docker, `localhost` é o próprio container, então os serviços usam os nomes uns dos outros. Cada serviço faz bind em `0.0.0.0`.
- Na sua máquina, use IPs entre os serviços. `APP_HOST=localhost` pode deixar a API só no IPv6 `::1`, enquanto o Java resolve `localhost` para `127.0.0.1` e falha com erro de conexão. Mantenha `APP_HOST=127.0.0.1`, ou use `ERP_API_URL=http://[::1]:<porta>` se ficar com `localhost`.
- Navegadores tentam os dois endereços, então `localhost` funciona no `VITE_API_URL`.

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

## Documentação da API

| Serviço | Docs interativas | Spec |
| --- | --- | --- |
| API | `/docs`, por exemplo http://localhost:3333/docs | `/openapi.json` |
| Billing | `/docs`, por exemplo http://localhost:8081/docs | `/v3/api-docs` |
| Importador (gRPC) | [`importer/README.md`](importer/README.md) | [`importador.proto`](proto/importador/v1/importador.proto) |

Nas docs da API, chame `POST /user/login` e cole o token em **Authorize**. O spec da API é gerado por `api/src/docs/openapi.ts` a partir dos mesmos schemas Zod que validam as requisições. Adicione as rotas novas lá também. `/internal/billing` fica de fora porque só o serviço de billing a chama.

## Variáveis de ambiente

O `api/.env.example` documenta todas as variáveis. Estas são as que importam para rodar o projeto:

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | sim | Connection string do Postgres (adicione `?sslmode=disable` para Postgres sem TLS) |
| `JWT_SECRET` | sim | Assina os tokens de login |
| `PORT` | não | Porta da API (padrão `10000`; o `.env.example` usa `3333`) |
| `APP_HOST` | não | Endereço de bind (padrão `0.0.0.0`; ignorado no Render). Veja [Hosts e portas](#hosts-e-portas) |
| `CORS_ORIGINS` | não | Origens web que podem chamar a API, separadas por vírgula (padrão `http://localhost:5173`) |
| `WEB_URL` | não | Endereço da web usado nos links de redefinição de senha |
| `RESEND_API_KEY`, `EMAIL_FROM` | não | E-mails de "Esqueceu a senha?" pelo [Resend](https://resend.com) |
| `INTEGRATIONS_ENCRYPTION_KEY`, `API_PUBLIC_URL`, `JIRA_*`, `HUBSPOT_*` | não | Integrações com Jira / HubSpot |
| `IMPORTER_GRPC_URL` | não | Endereço do importador de planilhas em Go (`host:porta`). Vazio: a própria API roda a importação de produtos |
| `BILLING_INTERNAL_TOKEN` | não | Permite que o [serviço de billing](#serviço-de-billing-stripe) chame `/internal/billing`. Sem ele, toda chamada recebe 401 |
| `VITE_API_URL` (`web/.env`) | sim | Endereço da API como o navegador a acessa |

## Migrations do banco

O `01_schema.sql` já inclui todas as migrations de `api/drizzle/` (0000-0013), e o `02_seed.sql` as registra no log de migrations do drizzle. Para aplicar migrations adicionadas depois:

```bash
cd api
bun run db:migrate
```

Para o banco do Docker Compose, rode da sua máquina contra a porta publicada:

```bash
cd api
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sample_erp?sslmode=disable' bun run db:migrate
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
| `importer/` | `go run ./cmd/importer` | Importador de planilhas (lê o `importer/.env`) |
| raiz | `go test -p 1 ./importer/...` | Testes do importador; defina `IMPORTER_TEST_DATABASE_URL` com um banco descartável para rodar também os que usam banco |
| raiz | `buf generate` | Gera de novo o código gRPC Go e TypeScript depois de mudar o `proto/` |
