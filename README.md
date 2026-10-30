# sample-ERP

**English** · [Português](README.pt-BR.md)

Inventory and audit ERP: products, categorias, usuarios and auditorias, with optional Jira / HubSpot integrations.

| Folder | What it is |
| --- | --- |
| `api/` | REST API: Express 5, TypeScript, PostgreSQL (`pg` + drizzle), pg-boss job queue |
| `web/` | Web app: React 18, Vite, Tailwind, TanStack Query |
| `importer/` | Spreadsheet importer: Go, gRPC. Reads `.xlsx`/`.csv` product spreadsheets and saves them in the background, with its job queue in Postgres |
| `billing/` | Stripe service: Spring Boot, Java 21. Receives Stripe's webhooks and tells the API about paid and failed invoices |
| `proto/` | gRPC contract between the API and the importer; `buf generate` writes the Go and TypeScript code from it |
| `docker/postgres/init/` | SQL that creates the database from scratch: `01_schema.sql` (tables, types, indexes) and `02_seed.sql` (categorias + drizzle's migration log) |

Choose how to run it:

1. [Docker Compose](#1-docker-compose-raw-postgres): the fastest option. Starts Postgres, the API, the spreadsheet importer and the web app with one command, and the [billing service](#billing-service-stripe) when you ask for it.
2. [Local with raw Postgres](#2-local-with-raw-postgres): the API and web app run on your machine; Postgres is any plain instance.
3. [Local with Supabase](#3-local-with-supabase): the API and web app run on your machine; the database is a Supabase project.

## Prerequisites

- [Git](https://git-scm.com/)
- Option 1: [Docker](https://docs.docker.com/get-docker/) with Compose v2.24+
- Options 2 and 3: [Bun](https://bun.sh/) 1.x, [Node.js](https://nodejs.org/) 22+ and `psql` (comes with the [PostgreSQL client](https://www.postgresql.org/download/)); [Go](https://go.dev/dl/) 1.26+ only for the optional spreadsheet importer

```bash
git clone https://github.com/raulbattistini3-sys/sample-ERP.git
cd sample-ERP
```

## 1. Docker Compose (raw Postgres)

```bash
docker compose up --build
```

| Service | Address |
| --- | --- |
| Web | http://localhost:8080 |
| API | http://localhost:3333 |
| Postgres | `localhost:5432`, user `postgres`, password `postgres`, database `sample_erp` |
| Importer (gRPC) | `localhost:50051`, for local tools only (the API reaches it at `importer:50051`) |
| Billing (optional) | http://localhost:8081, with `--profile billing` |

On its first start, Postgres runs the scripts in `docker/postgres/init/`, so the database comes up with every table and the categorias already created. Data is kept in the `db-data` volume.

- Is port 5432 already in use? Start it with `DB_PORT=5433 docker compose up --build`.
- Optional settings (Resend emails, Jira / HubSpot OAuth) are read from `api/.env` when that file exists. See [Environment variables](#environment-variables).
- Start over with an empty database: `docker compose down -v`. The init scripts run again on the next `up`.
- The init scripts only run on an empty volume, so on every `up` the one-shot `migrate` service applies any [migrations](#database-migrations) the database hasn't seen before the API and the importer start. A `db-data` volume from an older checkout catches up by itself; if a migration fails (for example 0012 finding repeated SKUs), its log says why and the API and importer wait for it.
- Port 50051 already in use? Start it with `IMPORTER_PORT=50052 docker compose up --build`.
- Port 8081 already in use? Start billing with `BILLING_HOST_PORT=8082 docker compose --profile billing up --build`.

Then [create the first user](#create-the-first-user).

## 2. Local with raw Postgres

### 2.1 Database

Use any PostgreSQL 17+ instance: a local install, a server, or only the compose database (`docker compose up -d db`, which already runs the init scripts; skip to 2.2).

Create the database and load the schema:

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

Edit `api/.env`:

```dotenv
# sslmode=disable is required: the API asks for SSL by default and a plain Postgres has no TLS
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sample_erp?sslmode=disable
JWT_SECRET=<any long random string>
```

```bash
bun run dev
```

The API listens on http://localhost:3333 (`PORT` in `.env`).

### 2.3 Web

In another terminal:

```bash
cd web
cp .env.example .env    # VITE_API_URL=http://localhost:3333
bun install
bun run dev
```

Open http://localhost:5173 and [create the first user](#create-the-first-user).

### 2.4 Spreadsheet importer (optional)

Without it, the API runs product imports itself, in the background. With it, the API hands the uploaded file to the importer, which does that work in its own process. [`importer/README.md`](importer/README.md) covers how it works, its gRPC API and its limits. In another terminal:

```bash
cd importer
cp .env.example .env    # DATABASE_URL: the same as api/.env
go run ./cmd/importer
```

Then add this to `api/.env` and restart the API:

```dotenv
IMPORTER_GRPC_URL=localhost:50051
```

## 3. Local with Supabase

### 3.1 Create the project and load the schema

1. Create a project at [supabase.com](https://supabase.com/dashboard) and note the database password.
2. Under **Connect**, copy the **Session pooler** connection string. It looks like `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. Load the schema:

```bash
psql "<session pooler connection string>" -v ON_ERROR_STOP=1 \
  -f docker/postgres/init/01_schema.sql \
  -f docker/postgres/init/02_seed.sql
```

4. Enable Row Level Security. Supabase exposes every table in `public` through its Data API, so without RLS anyone with the project's anon key can read them. The API connects as `postgres`, which bypasses RLS, so this doesn't affect it:

```bash
psql "<session pooler connection string>" -c "
do \$\$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end \$\$;"
```

### 3.2 API and web

Follow [2.2](#22-api) and [2.3](#23-web), but in `api/.env` use the Supabase connection string **without** `sslmode=disable`. Supabase requires SSL, and the API already connects with it:

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
JWT_SECRET=<any long random string>
```

## Billing service (Stripe)

`billing/` receives Stripe's webhooks. For a paid or failed invoice it saves the event, and a background job then calls the API, which sends the email through Resend:

```text
Stripe -> billing (/webhooks/stripe) -> API (/internal/billing/events) -> Resend
```

The webhook never sends email itself. Its tables live in a `billing` schema of the same database as the API, and Flyway applies its migrations **every time the service starts**.

Create `billing/.env` from `billing/.env.example`:

| Variable | Purpose |
| --- | --- |
| `SANDBOX_STRIPE_API_KEY` | Sandbox key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`, printed by `stripe listen` |
| `JDBC_DATABASE_URL` | The database, with credentials in the URL. On Supabase use the **session pooler (port 5432)**: the service refuses to start on the transaction pooler (6543) |
| `ERP_API_URL` | The API, using an IP and not `localhost` |
| `BILLING_INTERNAL_TOKEN` | The same value as in `api/.env`. Without it the API answers 401 |

With Docker, `JDBC_DATABASE_URL`, `ERP_API_URL` and `BILLING_INTERNAL_TOKEN` come from `docker-compose.yml`, so only the Stripe values matter:

```bash
docker compose --profile billing up --build
```

Without Docker, set `BILLING_INTERNAL_TOKEN` in `api/.env` too, restart the API (`.env` changes don't trigger a reload), and start the service from its folder, because that's where it looks for `.env`:

```bash
cd billing
./mvnw spring-boot:run
```

Then forward Stripe's events, on your machine in both cases:

```bash
npm install -g @stripe/cli
stripe login
stripe listen --thin-events "v1.invoice.paid,v1.invoice.payment_failed" \
  --forward-thin-to localhost:8081/webhooks/stripe \
  --forward-thin-connect-to localhost:8081/webhooks/stripe
stripe trigger invoice.paid --override customer:email=delivered@resend.dev
```

Without a customer email the event is stored and no notification is created.

### Dependency injection

Spring creates the service's objects (beans) and passes each one what it needs through its constructor. Nothing calls `new` on a collaborator or uses `@Autowired` on a field, so the fields stay `final`.

| Bean | Declared by | Receives |
| --- | --- | --- |
| `StripeWebhookController` | `@RestController` | `StripeClient`, `StripeProperties`, `StripeEventRecorder` |
| `StripeEventRecorder` | `@Service` | `StripeEventRepository`, `NotificationRepository` |
| `NotificationSender` | `@Component` | `NotificationRepository`, `RestClient` |
| `StripeClient` | `@Bean` in `StripeConfig` | `StripeProperties` |
| `RestClient` | `@Bean` in `NotificationConfig` | `ErpProperties` |
| `StripeProperties`, `ErpProperties` | `@ConfigurationProperties` records | Values from `application` properties and the environment |
| `StripeEventRepository`, `NotificationRepository` | Spring Data interfaces | Spring generates the implementations |

- **Finding beans:** `@SpringBootApplication` scans `com.simple_erp.billing` and its subpackages. Classes are package-private where possible, because Spring doesn't need them to be public.
- **Constructors:** `StripeEventRecorder` and `NotificationSender` get theirs from Lombok's `@RequiredArgsConstructor`, one parameter per `final` field. `StripeWebhookController` writes its own, because it builds the Stripe handler there.
- **Third-party classes:** `StripeClient` and `RestClient` can't carry Spring annotations, so a `@Bean` method in a `@Configuration` class builds them. The method's parameters are injected the same way.
- **Transactions:** Spring injects a proxy of `StripeEventRecorder`, and that proxy opens the transaction. `@Transactional` only applies to calls that come from another bean, so a call from inside the same class skips it.
- **Tests:** `StripeEventRecorderTest` calls the constructor directly with mocks and needs no Spring. `StripeWebhookControllerTest` starts only the web layer and replaces `StripeEventRecorder` with `@MockitoBean`.

To add a dependency, declare it as a `private final` field. To add a collaborator, annotate the class with `@Service` or `@Component` inside the base package.

## Hosts and ports

| From | To | Docker | On your machine |
| --- | --- | --- | --- |
| Browser | API | `http://localhost:3333` | `VITE_API_URL` |
| API | Importer (gRPC) | `importer:50051` | `IMPORTER_GRPC_URL`, for example `127.0.0.1:50051` |
| API, importer | Postgres | `db:5432` | `DATABASE_URL` |
| Billing | API | `http://api:3333` | `ERP_API_URL`, for example `http://127.0.0.1:3333` |
| Billing | Postgres | `db:5432` | `JDBC_DATABASE_URL` |
| Stripe CLI | Billing | `localhost:8081` | `localhost:8081` |

- Inside Docker, `localhost` is the container itself, so services use each other's names. Each service binds `0.0.0.0`.
- On your machine, use IPs between services. `APP_HOST=localhost` can bind the API to IPv6 `::1` only, while Java resolves `localhost` to `127.0.0.1` and fails with a connection error. Keep `APP_HOST=127.0.0.1`, or set `ERP_API_URL=http://[::1]:<port>` if you keep `localhost`.
- Browsers try both addresses, so `localhost` is fine in `VITE_API_URL`.

## Create the first user

1. Open the web app and sign up at `/register`. New accounts get the `Estoque` role.
2. Promote that account to `SU` (superuser, which manages admins). From `api/`, with `DATABASE_URL` in `api/.env` pointing at the database:

```bash
bun run admin:promote you@example.com          # SU
bun run admin:promote you@example.com --role ADM
```

With Docker Compose you can run it through `psql` instead:

```bash
docker compose exec db psql -U postgres -d sample_erp \
  -c "update usuarios set permissoes = 'SU' where lower(email) = lower('you@example.com')"
```

The API reads the role on every request. Log out and back in so the web app shows the new role too.

## API documentation

| Service | Interactive docs | Spec |
| --- | --- | --- |
| API | `/docs`, for example http://localhost:3333/docs | `/openapi.json` |
| Billing | `/docs`, for example http://localhost:8081/docs | `/v3/api-docs` |
| Importer (gRPC) | [`importer/README.md`](importer/README.md) | [`importador.proto`](proto/importador/v1/importador.proto) |

In the API docs, call `POST /user/login`, then paste the token under **Authorize**. The API's spec is built by `api/src/docs/openapi.ts` from the same Zod schemas that validate requests. Add new routes there too. `/internal/billing` is left out because only the billing service calls it.

## Environment variables

`api/.env.example` documents every variable. These are the ones that matter for running the project:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (add `?sslmode=disable` for Postgres without TLS) |
| `JWT_SECRET` | yes | Signs login tokens |
| `PORT` | no | API port (default `10000`; `.env.example` uses `3333`) |
| `APP_HOST` | no | Bind address (default `0.0.0.0`; ignored on Render). See [Hosts and ports](#hosts-and-ports) |
| `CORS_ORIGINS` | no | Web origins allowed to call the API, comma-separated (default `http://localhost:5173`) |
| `WEB_URL` | no | Web address used in password reset links |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | "Forgot password" emails through [Resend](https://resend.com) |
| `INTEGRATIONS_ENCRYPTION_KEY`, `API_PUBLIC_URL`, `JIRA_*`, `HUBSPOT_*` | no | Jira / HubSpot integrations |
| `IMPORTER_GRPC_URL` | no | Go spreadsheet importer address (`host:port`). Empty: the API runs product imports itself |
| `BILLING_INTERNAL_TOKEN` | no | Lets the [billing service](#billing-service-stripe) call `/internal/billing`. Unset: every call gets 401 |
| `VITE_API_URL` (`web/.env`) | yes | API address as the browser reaches it |

## Database migrations

`01_schema.sql` already includes every migration in `api/drizzle/` (0000-0013), and `02_seed.sql` records them in drizzle's migration log. To apply migrations added later:

```bash
cd api
bun run db:migrate
```

For the Docker Compose database, run it from your machine against the published port:

```bash
cd api
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sample_erp?sslmode=disable' bun run db:migrate
```

## Useful scripts

| Where | Command | What it does |
| --- | --- | --- |
| `api/` | `bun run dev` | API with reload on save |
| `api/` | `bun run build` then `bun run start` | Production build (`dist/`) and start |
| `api/` | `bun run db:migrate` | Apply new SQL migrations from `api/drizzle/` |
| `api/` | `bun run admin:promote <email> [--role SU\|ADM]` | Promote a user |
| `web/` | `bun run dev` | Vite dev server on :5173 |
| `web/` | `bun run build` | Production build (`dist/`) |
| `importer/` | `go run ./cmd/importer` | Spreadsheet importer (reads `importer/.env`) |
| root | `go test -p 1 ./importer/...` | Importer tests; set `IMPORTER_TEST_DATABASE_URL` to a throwaway database to run the database ones too |
| root | `buf generate` | Regenerate the Go and TypeScript gRPC code after changing `proto/` |
