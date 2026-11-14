# Architecture

How the services fit together, in the two ways the stack runs: `docker compose` (Linux containers) and the
native Windows launcher (`sample-erp.exe` plus `services/*.exe`). Both have the same shape; only the
addresses and where the keys live change.

## Docker compose

Only the API (3333) and the web app (8080) are published on the host. Everything else is on the compose
network, reached by service name.

```mermaid
flowchart LR
    browser([Browser])
    stripe_cloud([Stripe])
    hubspot([HubSpot / Jira / Resend])

    subgraph host["Host: published ports"]
        web["web<br/>nginx + React build<br/>:8080"]
        api["api<br/>Express 5 / TypeScript<br/>:3333"]
    end

    subgraph net["compose network (internal only)"]
        importer["importer<br/>Go, gRPC<br/>importer:50051"]
        vault["vault<br/>Go, HTTPS<br/>vault:8200"]
        network["network<br/>registry :7070 + gateway :8080"]
        billing["billing<br/>Spring Boot<br/>billing:8081<br/>(profile billing)"]
        stripecli["stripe CLI<br/>(profile billing)"]
        db[("db<br/>Postgres 17<br/>sample_erp")]
        vaultdb[("vault-db<br/>Postgres 17<br/>sample_erp_vault")]
        migrate["migrate<br/>(one-shot)"]
    end

    subgraph secrets["./secrets (generate.ts, gitignored)"]
        senv["secrets.env<br/>JWT_SECRET, tokens"]
        tls["tls/<br/>ca, api, importer, vault, billing, web"]
        keys["vault/<br/>kek-1.key, index.key"]
    end

    browser -->|"HTTPS, TLS 1.3"| web
    browser -->|"REST + WS over TLS 1.3 (JWT HS256)"| api
    api -->|"gRPC, mutual TLS"| importer
    api -->|"HTTPS, mutual TLS<br/>+ VAULT_TOKEN"| vault
    api -->|"HTTPS, mutual TLS (CN api)"| billing
    billing -->|"/internal/billing, mutual TLS (CN billing)"| api
    api & importer & billing -.->|"announce (NETWORK_TOKEN)"| network
    api --> db
    importer --> db
    billing -->|"billing schema"| db
    migrate --> db
    vault --> vaultdb
    stripe_cloud -->|webhooks| stripecli -->|forward| billing
    api --> hubspot
    importer -->|client imports| hubspot

    senv -.-> api & billing & importer & network & vault & vaultdb
    tls -.-> api & importer & vault & billing & web & network
    keys -.->|read-only mount| vault
```

## Native launcher (Windows)

In local development, `go run ./network/cmd/network dev` gives the same shape: the network process starts `web` and `api` as children, and the API starts `importer`, `vault` and `billing` as its own (`API_CHILDREN`); logs come out in one terminal prefixed `[name]`, and Ctrl+C stops the tree from the API down (SIGTERM, then a kill after the grace period).

`sample-erp.exe` starts an embedded Postgres and supervises every service as a child process. All of them
listen on `127.0.0.1`; the network gateway is the only port a browser (or Stripe) reaches.

```mermaid
flowchart LR
    browser([Browser])
    subgraph pc["Windows PC"]
        launcher["sample-erp.exe<br/>(supervisor)"]
        gw["network.exe<br/>gateway :8080 (ERP_WEB_PORT)<br/>serves web/dist, /api, /billing"]
        api["api.exe<br/>127.0.0.1:3333"]
        imp["importer.exe<br/>127.0.0.1:50051"]
        vault["vault.exe<br/>127.0.0.1:8200"]
        bill["billing (jlink JRE)<br/>127.0.0.1:8081, optional"]
        pg[("embedded Postgres :5433<br/>sample_erp + sample_erp_vault")]
        data["data/<br/>secrets.env, certs/,<br/>vault-keys/ (DPAPI)"]
    end
    browser --> gw --> api
    gw --> bill
    api -->|mTLS gRPC| imp
    api -->|mTLS HTTPS| vault
    api & imp --> pg
    vault -->|sample_erp_vault| pg
    launcher -.->|spawns + env| gw & api & imp & vault & bill & pg
    data -.-> launcher
```

## Where sensitive data lives

| Data | Where | Protection |
| --- | --- | --- |
| Passwords | `usuarios.senha` | Argon2id hash |
| Usuario CPF, birth date (`YYYY-MM-DD`) | vault, `owner_type = usuario`, `owner_id = usuarios.id` | AES-256-GCM per record (random DEK) wrapped by a versioned KEK; CPF lookup through an HMAC-SHA-256 blind index |
| Integration OAuth tokens | `integracoes.*_cifrado` | AES-GCM with `INTEGRATIONS_ENCRYPTION_KEY` (next to move into the vault) |
| Client e-mail / phone | HubSpot (read live), `clientes` cache | next to move into the vault |
| Service tokens | `secrets/secrets.env` / `data/secrets.env` | the receiving side compares SHA-256 digests in constant time |
| Vault KEK + index key | `secrets/vault/` (compose) or `data/vault-keys/` (launcher) | file mode 0600; on Windows DPAPI-encrypted for the current user |

The vault and the ERP database are linked only logically: a vault record's `owner_id` is the ERP row's id.
The API writes the ERP row first, then the vault record, and removes the row if the vault refuses it.
