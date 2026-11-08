# pkg

Code shared by more than one service, kept outside all of them, the way a Go project keeps shared
packages in `pkg/`. Plain JavaScript typed with JSDoc: no build step, so the API (Bun, or Node after
`tsc`) and the web app (Vite) import the same files.

| Package | What | Used by |
|---|---|---|
| `tablecore/` | Columnar table in one `ArrayBuffer` (TCC1 format, typed-array views, strings in a dictionary), the filter/sort both threads run (`runOp`), an inverted text index for word-start search, typo-tolerant (fuzzy) word matching, a Web Worker running the same code, a per-device cost model and the scheduler that picks main thread or worker per operation | API: encodes the product snapshot (`columnar.js`) and splits search words like the web (`text-index.js`). Web: the product list's local search (`web/src/features/produtos/search`) |
| `telemetry/` | One event shape (`{ source, type, ts, data }`), browser collectors (long animation frames, interactions, compute pressure, heap), exporters (scheduler signals, in-memory log, `fetch` to a collector, NDJSON) and the bus between them | Web: `web/src/lib/telemetry.ts`, posting to `POST /api/telemetry`. API: `api/src/utils/telemetry/telemetry.ts`, writing `TELEMETRY_DIR/<date>.ndjson` |

`tablecore` comes from the TCC prototype (`experiments/tcc-v1/src`, commit `d478a1d`). It is unchanged
except that the folders are flattened, numeric `in` filters and the `fuzzy` search were added, and
telemetry moved here as its own package. Changes in `telemetry`: the `fetch` and NDJSON exporters were added, and the pressure
timestamps fixed (Chromium's `PressureRecord.time` is already relative to `timeOrigin`).

## How the product search uses it

```
first paint    web ──GET /api/products/scroll──▶ API ──▶ Postgres      (one page of 30, as before)
then           web ──GET /api/products/snapshot─▶ API (cached, gzip, ETag)
               API: rows ─▶ encodeColumnar ─▶ TCC1 buffer
               web: openColumnar(buffer)  (no parsing)  ──clone──▶ Worker (its own copy)
each search    scheduler.decide(spec): predicted ms on main vs worker, against a 50 ms budget scaled by
               the main thread's recent load (LoAF) and compute pressure
               ─▶ runOp on main, or postMessage ─▶ worker runOp ─▶ indices (transferred back)
               ─▶ decode only the visible rows ─▶ table
               ─▶ telemetry: decision + timings ─▶ POST /api/telemetry ─▶ NDJSON
```

`?strategy=main|worker|fixed|adaptive` on `/products` pins the scheduler for experiments.

**While the worker warms up.** Building the name index takes about 1.4 s on 600k real names (the second
search takes 6 ms, so this cost is index building, not JIT warm-up). A search that would go to the worker before it
has the index it needs (`scheduler.coldFor(spec)`) is answered by the server instead. The local run still goes
ahead and replaces the server's rows when it lands. `window.__erpSearchWarm` turns true when the warm-up is
done. The server side of this is fast thanks to the trigram indexes on `produtos.sku` and `produtos.name`
(`api/drizzle/0021_produtos_trgm_idx.sql`).

**Transport to the API.** Server pages go over REST (`GET /products/scroll`, JSON) or over a WebSocket with
protobuf frames (`proto/produtos/v1/busca.proto`, served by `api/src/sockets/produtos.socket.ts` on the
API's own port at `/ws`). `?transport=rest|socket` or `VITE_PRODUCTS_TRANSPORT` picks one; REST is the
default. When the socket can't connect, for example behind the launcher's gateway, which doesn't forward
sockets yet, the request falls back to REST. Every request emits a `transport`/`request` telemetry event with
`requested`, `transport`, `cold` (the first request of that transport in this page load), `ms`,
`connectMs` (socket), `bytes` and `fallback`, for comparing the two on cold runs.

## Fuzzy word matching (`fuzzy.js`, `similarity.js`)

The name search is the `fuzzy` op. Each query word decides how it matches:

1. **Word start.** Some index term starts with the word: the same as `prefix`, score 1.
2. **Similar words.** No term does (a typo, a missing accent):
   - **Recall:** a vector search over character trigrams. Each term, accents folded, is a sparse binary
     vector of its trigrams, kept as an inverted list from trigram to term ids (CSR in typed arrays).
     The query word's trigrams (`"  word"`, end left open while typing) count the shared trigrams per
     term. Terms holding at least 25% of the query's trigrams become candidates, best 256 first.
   - **Verification:** the optimal string alignment distance (Levenshtein plus swapped neighbours),
     measured against the closest *start* of the term. A word may be off by at most 1 edit up to
     5 letters and 2 edits beyond that. Words of 1–2 letters and numbers are never guessed.
   - **Score:** `0.5 · (1 − d/(k+1)) + 0.3 · Jaro–Winkler + 0.2 · containment`.
3. **No match.** Nothing close enough, and since every word must match, the query finds nothing.

When any word was guessed, rows are ranked by the mean score of their words, closest first. The result
carries how each word matched (`match.words`), and the web shows the guesses under the search bar.
The server's search stays exact (word starts), so typo tolerance appears once the local engine is ready.

Example, 100k real product names, warm: "smarthpone" → smartphone (7 ms), "geladera" → geladeira
(2 ms), "pelcula vidro" → película (2 ms). Building both indexes once takes about 310 ms, which the
worker absorbs at warm-up.

## SKU search (`digit-index.js`) and narrowing

SKUs are a prefix plus a zero-padded number (`LT-0000123`, `LT2-0300000`). `contains` on a dictionary
column builds, once per thread, a **digit index**. Strings are grouped by prefix and digit width, and
each group's numbers are kept sorted. A query matches in one of three places:

1. Inside the prefix: the whole group matches.
2. Across the boundary (`t-00012`): one range of numbers.
3. Inside the digits (`123`): one range per offset, about N/10^k ranges in all. Each range is a binary
   search, so the work follows the number of matches.

When the ranges would cost more than reading the group (`0` on 7-digit numbers), the group is read
instead. Columns that aren't shaped like that (names, free text, more than 64 groups, more than 10%
without a trailing number) get no index, and `contains` scans as before. Matches are always exactly what
`includes` (and the API's `ILIKE '%…%'`) finds.

**Narrowing.** Each thread keeps its last `contains` result. When the next spec only tightens it (the
text still holds the old text, other filters equal or added), the changed filters test only those rows.
A last result holding more than half the rows is not reused, because one straight pass is cheaper.
`fuzzy` filters always run again, since their ranking comes from running them. The scheduler predicts
main-thread cost from the narrowed row count, and the cost model learns per row actually tested
(`stats.tested`).

`node test/bench-sku-search.js` on 600k rows shaped like the real table, one laptop, ms per keystroke:
the old scan takes 150–600, the index 8–70 (the most for 1-character queries), and the index plus
narrowing under 1 once a few characters are typed. Building the index takes about 200 ms; the worker's
warm-up search (`sku contains "a"`) pays it.

## How each runtime loads it

| Runtime | How |
|---|---|
| Web (Vite) | the `@pkg` alias (`web/vite.config.ts`), bundled; the worker is an ES module worker |
| API, `bun dev` (ts-node-dev) | Node loads `pkg/` itself as ES modules through `require(esm)`, so it needs **Node 22.12+**. `api/tsconfig.json` sets `allowJs: false` for ts-node only: compiling these files to CommonJS inside a `"type": "module"` package is what fails with "Must use import to load ES Module" |
| API, `tsc` build (Docker) | `allowJs` + `rootDir: ".."`: compiled to CommonJS under `dist/pkg`, entry at `dist/api/src/index.js` |
| API, `bun build --compile` (launcher) | bundled, nothing to configure |

## Commands

```sh
cd pkg
node --test "test/*.test.js"     # 22 tests
../web/node_modules/.bin/tsc -p jsconfig.json --typeRoots ../web/node_modules/@types   # type-check the JSDoc
```
