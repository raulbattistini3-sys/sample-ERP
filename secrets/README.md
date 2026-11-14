# secrets/

Random secrets the services share, one per boundary, written by `generate.ts`. Only the script,
`package.json`, `bun.lock` and this file are committed; everything it writes is gitignored.

```bash
bun install
bun generate.ts                        # writes what's missing, keeps the rest
bun generate.ts --rotate jwt,tls       # new values for some: jwt, network, vault, tls
bun run network-token                  # a NETWORK_TOKEN on its own (64 hex), with where it goes
bun generate.ts --force                # new values for all
```

| Output | Used as |
| --- | --- |
| `jwt_secret` | `JWT_SECRET` (api): HS256 key made by jose, checked by signing and verifying a token |
| `network_token` | `NETWORK_TOKEN` (every service): 64 lowercase hex characters, the SHA-256 of 32 random bytes. `bun run network-token --check <value>` checks one |
| `secrets.env` | the values above; `docker-compose.yml` loads it into each service |
| `tls/ca.crt`, `tls/ca.key` | the private CA of every internal certificate (import `ca.crt` into the browser's store for the HTTPS web app and API) |
| `tls/importer.crt`, `tls/importer.key` | importer server certificate (`importer`, `localhost`, `127.0.0.1`) |
| `tls/api.crt`, `tls/api.key` | API: HTTPS server (TLS 1.3; `api`, `localhost`, `127.0.0.1`) and client certificate |
| `tls/billing.crt`, `tls/billing.key` | billing: server and client (mutual TLS with the API; replaces `BILLING_INTERNAL_TOKEN`) |
| `tls/web.crt`, `tls/web.key` | the web app's HTTPS (Vite dev server, nginx in compose) |
| `tls/network.crt`, `tls/network.key` | the network gateway's HTTPS (`NETWORK_TLS_CERT`/`NETWORK_TLS_KEY`) |

Without Docker, copy the values from `secrets.env` into `api/.env`; the `.env.example` files already point
`API_TLS_*`, `IMPORTER_TLS_*`, `GRPC_TLS_*` and `BILLING_TLS_*` at `../secrets/tls/`.

## Vault

`generate.ts` also writes `vault_token`, `vault_admin_token`, `vault_db_password`, `tls/vault.{crt,key}` and
`vault/kek-1.key` + `vault/index.key`. The two keys are created once and never replaced by `--force` or
`--rotate`: losing them makes every vault record unreadable, so back up this folder. Internal tokens are the
hex SHA-256 of 32 random bytes; the receiving service compares SHA-256 digests in constant time.
