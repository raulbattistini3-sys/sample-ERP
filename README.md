# sample-ERP

**English** · [Português](README.pt-BR.md)

Inventory and audit ERP: products, categorias, usuarios and auditorias, with optional Jira / HubSpot integrations.

| Folder | What it is |
| --- | --- |
| `api/` | REST API: Express 5, TypeScript, PostgreSQL (`pg` + drizzle), pg-boss job queue |
| `web/` | Web app: React 18, Vite, Tailwind, TanStack Query |
| `importer/` | Spreadsheet importer: Go, gRPC. Reads `.xlsx`/`.csv` product spreadsheets and saves them in the background, with its job queue in Postgres |
| `vault/` | Vault: Go. Keeps sensitive data (usuarios' CPF and birth date) encrypted with AES-256-GCM in its own database, reached only by the API over mutual TLS |
| `secrets/` | `generate.ts`: makes the shared secrets, certificates and vault keys (gitignored output) |
| `billing/` | Stripe service: Spring Boot, Java 21. Receives Stripe's webhooks and tells the API about paid and failed invoices |
| `proto/` | gRPC contract between the API and the importer; `buf generate` writes the Go and TypeScript code from it |
| `docker/postgres/init/` | SQL that creates the database from scratch: `01_schema.sql` (tables, types, indexes) and `02_seed.sql` (categorias + drizzle's migration log) |

See [docs/architecture.md](docs/architecture.md) for a diagram of how the services connect.

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

The services share secrets (JWT key, internal tokens, mutual TLS certificates, the vault's keys) that are
never committed. Generate them once, then start the stack:

```bash
cd secrets && bun install && bun generate.ts && cd ..   # writes secrets/secrets.env, secrets/tls/, secrets/vault/
docker compose up --build -d
```

Only two ports are published on your machine; every other service is reachable only inside the compose network:

| Service | Address |
| --- | --- |
| Web | http://localhost:8080 |
| API | http://localhost:3333 |
| Postgres, importer, vault, vault-db, network, billing | internal only (`db:5432`, `importer:50051`, `vault:8200`, ...) |

To look into the database, use the container: `docker compose exec db psql -U postgres sample_erp`.

On its first start, Postgres runs the scripts in `docker/postgres/init/`, so the database comes up with every table and the categorias already created. Data is kept in the `db-data` volume (ERP) and `vault-data` (vault).

> **Keep your data: don't run `docker compose down`.** Stop and start the stack with `docker compose stop` /
> `docker compose start` (or `up -d` after a change). `down -v` deletes the `db-data` and `vault-data`
> volumes, which drops the whole database, and even a plain `down` removes the containers. If you do want a
> clean start, back up first: `docker compose exec db pg_dump -U postgres sample_erp > backup.sql`.
> Keep `secrets/vault/` too: without `kek-1.key` the vault's records can't be decrypted.

- Optional settings (Resend emails, Jira / HubSpot OAuth) are read from `api/.env` when that file exists. See [Environment variables](#environment-variables). The secrets from `secrets/secrets.env` always win over it.
- The init scripts only run on an empty volume, so on every `up` the one-shot `migrate` service applies any [migrations](#database-migrations) the database hasn't seen before the API and the importer start. A `db-data` volume from an older checkout catches up by itself; if a migration fails (for example 0012 finding repeated SKUs), its log says why and the API and importer wait for it.
- Billing and a Stripe CLI that forwards webhooks to it start with `docker compose --profile billing up --build -d` (set `SANDBOX_STRIPE_API_KEY` in `billing/.env`).
- After `bun generate.ts --rotate ...`, recreate the services that read it: `docker compose up -d --force-recreate api importer vault`.

Then [create the first user](#create-the-first-user).

## Whole stack in one terminal (development)

After the database and the `.env` files below are set up, one command starts everything as child processes of
one terminal, every line prefixed with the service's name:

```bash
go run ./network/cmd/network dev
```

```text
network ── web       bun run dev                    (web/)
        └─ api       bun run dev                    (api/)
             ├─ importer  go run ./cmd/importer     (importer/)
             ├─ vault     go run ./cmd/vault serve  (vault/)
             └─ billing   ./mvnw spring-boot:run -e (billing/)
```

The network service runs in that process. It starts the web app and the API, and the API starts the importer, the
vault and billing itself (`API_CHILDREN`, see `api/.env.example`). Ctrl+C stops the API first, which stops its own
children (SIGTERM, 20 s to finish), then the web app and the network. Whatever is still running after 30 s is
killed with everything it started (on Windows the children also sit in a job object that dies with the
supervisor). If the web app or the API exits, the rest is stopped too. `--no-web` / `--no-api` leave one out, and
`DEV_API_CHILDREN=importer` (or empty) narrows what the API starts. Every 5 minutes
(`DEV_HEALTH_INTERVAL`) the network asks its registry whether the API and the web app are healthy; with no
healthy API it stops everything. Set `NETWORK_TOKEN` in the shell to have every
child join the network. The Windows launcher and Docker Compose don't use this: there the launcher or Docker
supervises the services.

### Trusting the local CA

The web app and the API serve HTTPS with TLS 1.3 only, with certificates from `secrets/tls/` (signed by
`secrets/tls/ca.crt`). Import that CA once so the browser trusts `https://localhost:5173`, `https://localhost:8080`
and `https://localhost:3333`:

```bash
# Windows (current user; Chrome and Edge use it)
certutil -user -addstore Root secrets\tls\ca.crt
# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain secrets/tls/ca.crt
# Linux (Debian/Ubuntu); Firefox: Settings > Certificates > Import
sudo cp secrets/tls/ca.crt /usr/local/share/ca-certificates/sample-erp.crt && sudo update-ca-certificates
```

The CA key stays in `secrets/tls/ca.key` on your machine. Remove the CA from the store when you no longer need it.

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

Generate the shared secrets once (see [Shared secrets](#shared-secrets)):

```bash
cd secrets && bun install && bun generate.ts && cd ..
```

Edit `api/.env`:

```dotenv
# development: a plain connection (a local Postgres has no TLS); see "Database TLS" below
API_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sample_erp
JWT_SECRET=<from secrets/secrets.env, see "Shared secrets">
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

Follow [2.2](#22-api) and [2.3](#23-web), but in `api/.env` use the Supabase connection string:

```dotenv
API_ENV=production
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
JWT_SECRET=<from secrets/secrets.env, see "Shared secrets">
```

#### Database TLS

Each service that talks to Postgres has a required variable that decides how it connects:
`API_ENV` (the API: its pool, pg-boss, drizzle-kit and the scripts), `IMPORTER_ENV` (the importer) and
`BILLING_ENV` (billing, including Flyway).

| Value | Connection |
| --- | --- |
| `production` | TLS. The server's certificate is verified against `DATABASE_CA_CERT`, or else `prod-ca-2021.crt` (Supabase's root CA, in the repo root), found by searching from the service's working directory upwards. |
| `development` | Plain, unless a CA is found: `DATABASE_CA_CERT`, or a `.crt` file in the repo root (the same upward search). Then it is verified like production. |

The CA file is public, but it stays out of git (`.gitignore`): keep a copy in the repo root for local runs,
where the services find it. **A `.crt` on disk always means verified TLS**, in the API, the importer and
billing, whatever the environment: with `prod-ca-2021.crt` (or any single `.crt`) in the repo root, a
plain connection is never used. Several `.crt` files there are ambiguous, so the services stop and ask for
`DATABASE_CA_CERT`. The vault's own database is not affected. The Docker images don't include it. A production host mounts it as a secret
file and points `DATABASE_CA_CERT` at it (e.g. `/etc/secrets/prod-ca-2021.crt` on Render). Compose runs
everything in `development`, so it needs no CA.

Supabase accepts plain connections unless **Enforce SSL** is on (Database settings). Without TLS, though,
anyone on the network path can read or alter the traffic, credentials included. Deployments therefore use
`production`. Turning on Enforce SSL makes Supabase refuse every plain connection, including `development`
ones pointed at it.

#### Startup checks

Every service checks its configuration before doing anything. On a problem it prints one `[config]` line per
missing or invalid variable and exits with status 1.

| Service | Always required | Also required in production |
| --- | --- | --- |
| API | `API_ENV`, `DATABASE_URL`, `JWT_SECRET` | `CORS_ORIGINS`, `WEB_URL`, `API_TLS_*`, a readable CA |
| Importer | `IMPORTER_ENV`, `DATABASE_URL` | a readable CA |
| Billing | `BILLING_ENV`, `JDBC_DATABASE_URL`, `SANDBOX_STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `ERP_API_URL`, `BILLING_TLS_CERT`, `BILLING_TLS_KEY`, `BILLING_TLS_CA` | a readable CA |
| Web (`vite`, `vite build`) | `VITE_API_URL`, an http(s) URL | |

In production, `sslmode=disable` (or any other mode that doesn't verify the certificate) in the database URL is
refused too.

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
| `BILLING_TLS_CERT`, `BILLING_TLS_KEY`, `BILLING_TLS_CA` | Billing's certificate and the internal CA (`secrets/tls/`). API and billing talk over **mutual TLS, TLS 1.3**, both ways: `/internal/**` on billing answers only the API's certificate (CN `api`), `/internal/billing` on the API only billing's (CN `billing`). No shared token |

With Docker, `JDBC_DATABASE_URL`, `ERP_API_URL` and the certificates come from `docker-compose.yml`, so only the Stripe values matter:

```bash
docker compose --profile billing up --build
```

Without Docker, set `API_TLS_*` in `api/.env` (see `api/.env.example`), restart the API (`.env` changes don't trigger a reload), and start the service from its folder, because that's where it looks for `.env` (or let the API start it, see [Whole stack in one terminal](#whole-stack-in-one-terminal-development)):

```bash
cd billing
./mvnw spring-boot:run
```

Then forward Stripe's events, on your machine in both cases:

```bash
npm install -g @stripe/cli
stripe login
stripe listen --thin-events "v1.invoice.paid,v1.invoice.payment_failed" \
  --forward-thin-to https://localhost:8081/webhooks/stripe \
  --forward-thin-connect-to https://localhost:8081/webhooks/stripe --skip-verify
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
| API | Importer (gRPC, mTLS) | `importer:50051` | `IMPORTER_GRPC_URL`, for example `127.0.0.1:50051` |
| API | Vault (HTTPS, mTLS) | `https://vault:8200` | `VAULT_URL`, for example `https://127.0.0.1:8200` |
| Vault | its Postgres | `vault-db:5432` | `VAULT_DATABASE_URL` |
| API, importer | Postgres | `db:5432` | `DATABASE_URL` |
| Billing | API | `http://api:3333` | `ERP_API_URL`, for example `http://127.0.0.1:3333` |
| Billing | Postgres | `db:5432` | `JDBC_DATABASE_URL` |
| Stripe CLI | Billing | `billing:8081` (the `stripe` service) | `localhost:8081` |

- Inside Docker, `localhost` is the container itself, so services use each other's names. Each service binds `0.0.0.0`.
- On your machine, use IPs between services. `APP_HOST=localhost` can bind the API to IPv6 `::1` only, while Java resolves `localhost` to `127.0.0.1` and fails with a connection error. Keep `APP_HOST=127.0.0.1`, or set `ERP_API_URL=http://[::1]:<port>` if you keep `localhost`.
- Browsers try both addresses, so `localhost` is fine in `VITE_API_URL`.

## Create the first user

With Docker Compose or the native launcher (`launcher/`) there is nothing to do: the API creates a
superuser on a database without one. Sign in as `admin@sample-erp.local` with password `change-me`, and the
web app asks you to choose a new password before anything else. Change those defaults with
`BOOTSTRAP_SU_NAME`, `BOOTSTRAP_SU_EMAIL` and `BOOTSTRAP_SU_PASSWORD` (Compose) or `ERP_ADMIN_*` in
`bin/config/launcher.env` (launcher). Leave the `BOOTSTRAP_SU_*` variables unset in production. After
that, create other accounts in **Usuários**.

Without those variables (for example against Supabase):

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
| `API_ENV` | yes | `production` (verified TLS) or `development` (plain). See [Database TLS](#database-tls) |
| `DATABASE_URL` | yes | Postgres connection string |
| `DATABASE_CA_CERT` | no | CA certificate for the database's TLS (default: `prod-ca-2021.crt` from the repo root, in production) |
| `JWT_SECRET` | yes | HS256 key that signs login tokens (jose, `iss` sample-erp-api, `aud` sample-erp-web); 32+ characters, from `secrets/secrets.env` |
| `PORT` | no | API port (default `10000`; `.env.example` uses `3333`) |
| `APP_HOST` | no | Bind address (default `0.0.0.0`; ignored on Render). See [Hosts and ports](#hosts-and-ports) |
| `CORS_ORIGINS` | no | Web origins allowed to call the API, comma-separated (default `http://localhost:5173`) |
| `WEB_URL` | no | Web address used in password reset links |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | "Forgot password" emails through [Resend](https://resend.com) |
| `INTEGRATIONS_ENCRYPTION_KEY`, `API_PUBLIC_URL`, `JIRA_*`, `HUBSPOT_*` | no | Jira / HubSpot integrations |
| `IMPORTER_GRPC_URL` | no | Go spreadsheet importer address (`host:port`). Empty: the API runs product imports itself |
| `IMPORTER_TLS_CA`, `IMPORTER_TLS_CERT`, `IMPORTER_TLS_KEY` | in production | Mutual TLS to the importer: the CA, and the API's client certificate and key (`secrets/tls/`). `IMPORTER_TLS_SERVER_NAME` (default `importer`) is the name the importer's certificate must hold |
| `API_TLS_CERT`, `API_TLS_KEY`, `API_TLS_CA` | in production | HTTPS with TLS 1.3 only (`secrets/tls/api.*`); also the client certificate towards the importer, the vault and billing, and the CA that checks billing's certificate. Unset: plain HTTP and no billing |
| `API_CHILDREN` | no | Development: `importer,vault,billing` (any subset) run as the API's child processes |
| `VITE_API_URL` (`web/.env`) | yes | API address as the browser reaches it |

## Shared secrets

`secrets/generate.ts` (Bun, [jose](https://github.com/panva/jose) and `@peculiar/x509`) writes every secret the services share, each one random and used for one boundary only:

| File | Used as |
| --- | --- |
| `secrets/jwt_secret` | `JWT_SECRET`: an HS256 key (256 bits) for the login tokens |
| `secrets/network_token` | `NETWORK_TOKEN`, in every service ([format](#network_token-format)) |
| `secrets/vault_token`, `vault_admin_token` | `VAULT_TOKEN` for the API; the vault only gets their SHA-256 (`VAULT_TOKEN_SHA256`, `VAULT_ADMIN_TOKEN_SHA256`) |
| `secrets/vault_db_password` | `VAULT_DB_PASSWORD`, the vault database's password |
| `secrets/vault/` | `kek-1.key` (key-encryption key) and `index.key` (CPF blind index), mounted read-only into the vault; made once, never rotated by the script. Back them up |
| `secrets/secrets.env` | all of the above as `KEY=value`; docker compose loads it into each service |
| `secrets/tls/` | `ca.crt`, `importer.{crt,key}`, `vault.{crt,key}` (servers, names `importer`/`vault`, `localhost`, `127.0.0.1`) `api.{crt,key}` (server + client, names `api`, `localhost`, `127.0.0.1`), `billing.{crt,key}` (server + client) `web.{crt,key}` (the Vite dev server and nginx) and `network.{crt,key}` (the network gateway). TLS 1.3 for browser -> web and browser -> api; mutual TLS for api -> importer, api -> vault and api <-> billing |

```bash
cd secrets
bun install
bun generate.ts                        # writes what's missing, keeps the rest
bun generate.ts --rotate jwt,tls       # new values for some (jwt, network, vault, tls)
bun generate.ts --force                # new values for all
```

Everything in `secrets/` except the script is gitignored. Rotating `jwt` signs everyone out; after rotating `network` or `tls`, restart every service that uses it.

### NETWORK_TOKEN format

`NETWORK_TOKEN` is 64 lowercase hex characters: the SHA-256 of 32 random bytes, the same value in every service (the network service rejects anything under 32 characters). To make one, or check one you have:

```bash
cd secrets
bun run network-token                     # prints NETWORK_TOKEN=<64 hex> and where to paste it
bun run network-token --check <value>     # says whether a value has the expected format
``` Passwords are hashed with Argon2id (19 MiB, 2 passes); bcrypt hashes from before still sign in and are rehashed on that sign-in.

## Database migrations

`01_schema.sql` already includes every migration in `api/drizzle/` (0000-0013), and `02_seed.sql` records them in drizzle's migration log. To apply migrations added later:

```bash
cd api
bun run db:migrate
```

For the Docker Compose database, run it from your machine against the published port:

```bash
cd api
API_ENV=development DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sample_erp' bun run db:migrate
```

## Useful scripts

| Where | Command | What it does |
| --- | --- | --- |
| `api/` | `bun run dev` | API with reload on save |
| `api/` | `bun run build` then `bun run start` | Production build (`dist/`) and start |
| `api/` | `bun run db:migrate` | Apply new SQL migrations from `api/drizzle/` |
| `api/` | `bun run admin:promote <email> [--role SU\|ADM]` | Promote a user |
| `api/` | `bun run seed:fake [--produtos N] [--auditorias N] [--usuarios N] [--seed N]` | Fake products, usuarios and audit history in a local database (refuses production and remote hosts) |
| `api/` | `bun run seed:fake --remover` | Delete everything `seed:fake` created (`FK-` SKUs, `@demo.local` usuarios) |
| `api/` | `bun run seed:fake --planilha file.csv [--linhas N] [--com-erros]` | A spreadsheet for Produtos > Importar, optionally with invalid rows |
| `web/` | `bun run dev` | Vite dev server on :5173 |
| `web/` | `bun run build` | Production build (`dist/`) |
| `importer/` | `go run ./cmd/importer` | Spreadsheet importer (reads `importer/.env`) |
| root | `go test -p 1 ./importer/...` | Importer tests; set `IMPORTER_TEST_DATABASE_URL` to a throwaway database to run the database ones too |
| root | `buf generate` | Regenerate the Go and TypeScript gRPC code after changing `proto/` |
