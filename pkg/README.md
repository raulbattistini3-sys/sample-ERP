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
