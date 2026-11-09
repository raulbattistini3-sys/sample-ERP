sample-ERP · v0.0.1 · native launcher build

# How the ERP fits together

One launcher starts every service and Postgres, then puts them behind a single port. The product list now searches in the browser: the server paints the first page, and a columnar snapshot takes over from there.

## System

Everything a user touches goes through the gateway on `:8080`. The services listen on loopback only. The importer has no auth of its own, so the API is the only caller it trusts.

Service or store Local search path (new) Shared code in `pkg/` Third-party service

### One port, private services

The gateway is the only listener on the network. It rewrites forwarded headers and refuses `/api/internal` and `/billing/internal` outright. Billing also checks its bearer token on the servlet path, so a forged prefix can't reach those routes.

### Shared code without a shared owner

`pkg/` sits beside the services, like a Go project's `pkg`. The API encodes the snapshot with the same `columnar.js` the browser decodes it with. Both split search words with the same tokenizer, so the server and the browser find the same products.

### Docker Compose

Compose runs the same services without the gateway. nginx serves the web app and the browser calls the API directly. The api and web images now build from the repo root so they can copy `pkg/`.

## Product search, step by step

The first page comes from the server, as it always did. Once it's on screen, the whole visible catalog arrives as one binary file. Every filter and search after that runs in the browser, with no request per keystroke.

### The data structure

One `ArrayBuffer` with a typed array per column. Strings are stored once in a dictionary and rows hold integer codes. Names get an inverted index: sorted terms plus posting lists in `Uint32Array`s, binary-searched by word start, which acts as a flat B-tree with no per-node objects.

### The decision

For each search the scheduler predicts the cost on the main thread and in the worker, from coefficients it learns on this device. The main thread gets the job when it fits a 50 ms budget. That budget shrinks as long animation frames or compute pressure rise. `?strategy=main|worker|fixed|adaptive` pins it for experiments.

### Search rules

**Nome** matches when every typed word starts a word of the name, in any order. **SKU** matches any part of it. The server's fallback query follows the same rules, and an e2e test checks that both find the same products.

| Measured at 101,300 products | Where | Total | Main thread blocked |
| --- | --- | --- | --- |
| First page on screen | server | 0.4–0.6 s | n/a |
| Local search ready (download, open, worker copy) | browser | 1.3–3.3 s | n/a |
| Snapshot rebuild after a write (query, encode, gzip) | API | ≈1.5 s | nobody waits |
| Name search “cabo usb”, first time (builds the index) | main | 44 ms | 44 ms |
| Name search “cabo usb”, index built in the worker | worker | 4.2 ms | 0.0 ms |
| Name search, warm | main | 2–3.5 ms | 2–3.5 ms |
| SKU part “INF-00”, first time | main | 193 ms | 193 ms |
| SKU part “INF-00”, what adaptive chose | worker | 8.6 ms | 0.1 ms |

One Windows laptop, Chromium through Playwright, the launcher on localhost. Snapshot: 12.4 MB raw, 7.5 MB gzipped. Treat these as one run, not a benchmark.

## Where the code lives

`launcher/`Rust: bundle build (`cargo xtask dist`), process supervision, embedded Postgres, gateway `web/`React app; local search in `src/features/produtos/search`, telemetry in `src/lib/telemetry.ts` `api/`Express API; snapshot in `services/product_snapshot.service.ts`, telemetry sink in `utils/telemetry` `pkg/`Shared JavaScript: `tablecore` (from the TCC prototype) and `telemetry` `importer/`Go gRPC importer for spreadsheets `billing/`Spring service for Stripe and cobranças