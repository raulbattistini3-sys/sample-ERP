# Spreadsheet importer

A Go service that imports product spreadsheets in the background. The API hands it a file over gRPC and gets an import id back at once. Workers then read, validate and save the rows, and the API polls for the outcome.

It's optional. Without `IMPORTER_GRPC_URL`, the API runs imports itself, with the same rules and the same messages.

## How an import runs

```text
POST /products/imports                                   Postgres (importacoes)
  API ── IniciarImportacao ──> grpcserver ── Criar ──────> pendente + NOTIFY
                                                              │
                              worker <── LISTEN / polling ────┘
                                │ Reivindicar                 processando
                                │ read and validate every row
                                │ write in one transaction
                                └ Finalizar ───────────────> concluida | rejeitada | falhou
GET /products/imports/{id}
  API ── ObterImportacao ───> grpcserver ── Obter ───────> current status
```

- **The queue is the `importacoes` table.** Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so several instances can run side by side.
- **All or nothing.** If any row is invalid, the import ends as `rejeitada` and nothing is saved.
- **Stuck jobs recover.** A job in `processando` past `IMPORT_LEASE` goes back to the queue, and fails after `IMPORT_MAX_ATTEMPTS` claims, so a spreadsheet that crashes a worker can't loop forever.
- **A slow worker can't overwrite a newer one.** `tentativas` works as a fencing token: once a job is handed back, the old worker's `Finalizar` fails with `ErrReivindicacaoPerdida` and its writes roll back.
- **Auditorias match the API.** Each update that changes a product records an `Alteracao` auditoria and its integration envios.

| Status | Meaning |
| --- | --- |
| `pendente` | Waiting for a worker |
| `processando` | A worker holds it |
| `concluida` | Every row was saved |
| `rejeitada` | At least one row was invalid; nothing was saved. `erros` lists the rows |
| `falhou` | The file couldn't be read. `mensagem` says why |

## gRPC API

The contract is [`proto/importador/v1/importador.proto`](../proto/importador/v1/importador.proto). The server listens without TLS and has no authentication of its own, so keep it on a private network.

| RPC | Purpose | Errors |
| --- | --- | --- |
| `IniciarImportacao` | Queues a `.xlsx` or `.csv` and returns the import | `INVALID_ARGUMENT` (empty file, missing name or usuario, unsupported format, invalid UUID), `NOT_FOUND` (usuario), `INTERNAL` |
| `ObterImportacao` | Returns an import's current state | `INVALID_ARGUMENT` (invalid UUID), `NOT_FOUND`, `INTERNAL` |

The server also has `grpc.health.v1.Health` and reflection, so tools work without the `.proto` file:

```bash
grpcurl -plaintext localhost:50051 list
grpcurl -plaintext -d '{"service": "importador.v1.ImportadorService"}' localhost:50051 grpc.health.v1.Health/Check
grpcurl -plaintext -d '{"id": "<import-id>"}' localhost:50051 importador.v1.ImportadorService/ObterImportacao
```

After changing the `.proto`, regenerate the Go and TypeScript code from the repo root. Run `bun install` in `api/` first:

```bash
buf generate
```

## Limits

- **File size:** the gRPC server keeps the 4 MB default for incoming messages, while the API accepts uploads up to 15 MB. A larger file fails at the importer, so raise `grpc.MaxRecvMsgSize` in `cmd/importer/main.go` if you need more.
- **Rows:** `MAX_IMPORT_ROWS` defaults to 5,000 here and is 500,000 in the API (`api/src/utils/schemas/produto.schema.ts`). Set it to match. `docker-compose.yml` doesn't set it, so Docker imports stop at 5,000.

## Configuration

Copy `.env.example` to `.env`. Variables already in the environment win over that file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | required | The API's database, with its migrations applied. On Supabase use the session pooler (port 5432) |
| `GRPC_HOST` | `0.0.0.0` | Bind address. All IPv4 interfaces by default |
| `GRPC_PORT` | `50051` | Port |
| `MAX_IMPORT_ROWS` | `5000` | Rows per spreadsheet |
| `IMPORT_WORKERS` | `2` | Imports processed at once by this instance |
| `IMPORT_LEASE` | `5m` | How long an import may run before it counts as stuck |
| `IMPORT_MAX_ATTEMPTS` | `3` | Claims before a job that keeps crashing is failed |
| `IMPORT_POLL_INTERVAL` | `30s` | Fallback queue check and stuck-job sweep |

## Running and testing

Run these from the repo root, where `go.mod` is. To use a local `.env`, run the service from this folder.

```bash
go run ./importer/cmd/importer            # start it
go run ./importer/cmd/importer healthcheck   # exit code 0 when ImportadorService is SERVING
go test ./importer/...                    # database tests are skipped without the variable below
```

The tests that touch Postgres need an empty database:

```bash
IMPORTER_TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/importer_test?sslmode=disable" go test -p 1 ./importer/...
```

## Packages

Read them with `go doc`, for example `go doc ./importer/postgres`.

| Package | What it does |
| --- | --- |
| `cmd/importer` | Entry point: wires everything, serves gRPC, shuts down gracefully, and runs the `healthcheck` subcommand |
| `grpcserver` | The two RPCs, and the mapping from errors to gRPC status codes |
| `importacao` | The worker loop and the pipeline: read, validate, write |
| `planilha` | Streams the rows of a `.xlsx` or `.csv` |
| `postgres` | The job queue and the product and auditoria writes |
| `storage` | Commented-out object storage options. Files are kept in `importacoes.planilha` for now |
| `internal/config` | Reads and validates the environment |
