import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { encodeColumnar } from "../../../pkg/tablecore/columnar.js";
import IProductRepository from "../interfaces/product_interfaces/product_repository.interface";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { aoAlterarProdutos } from "../utils/cache/produtos_alterados";
import { emitApi } from "../utils/telemetry/telemetry";

// The product list as one binary columnar file (pkg/tablecore's TCC1 format): every visible product, one
// typed array per column, strings stored once in a dictionary. The web opens it with no parsing (typed-array
// views over the buffer), builds its search index from it, and from then on filters and searches in the
// browser (main thread or a Web Worker) instead of asking this API on every keystroke.
//
// Rows are in the list's order (name, id), so the web never sorts. It is built once per visibility (ADM/SU
// also see inactive products), gzipped once, and kept until products change: the writes in this process
// say so through avisarProdutosAlterados; writers this process can't hear (the Go importer, another API
// instance) are caught by MAX_AGE_MS.
//
// A rebuild takes ~1.5 s per 100k products, so no request waits for one if it can help it: after a write
// the variants already asked for are rebuilt in the background (debounced, so an import's burst of writes
// is one rebuild), and a copy older than MAX_AGE_MS is still served while its replacement builds.

const MAX_AGE_MS = 60_000;
const REBUILD_DEBOUNCE_MS = 1_000;

export type ProductSnapshot = {
   gzip: Buffer;
   bytes: number;
   rows: number;
   etag: string;
   builtAt: number;
};

class ProductSnapshotService {
   private readonly cache = new Map<boolean, ProductSnapshot>();
   private readonly building = new Map<boolean, Promise<Either<BaseAppError, ProductSnapshot>>>();
   private version = 0;
   // the visibilities someone asked for, the ones worth rebuilding ahead of the next request
   private readonly wanted = new Set<boolean>();
   private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

   constructor(private readonly productRepository: IProductRepository) {
      aoAlterarProdutos(() => this.clear());
   }

   clear() {
      this.version += 1;
      this.cache.clear();
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => {
         this.rebuildTimer = null;
         for (const variant of this.wanted) void this.start(variant);
      }, REBUILD_DEBOUNCE_MS);
      this.rebuildTimer.unref?.();
   }

   async get(includeInactive: boolean): Promise<Either<BaseAppError, ProductSnapshot>> {
      this.wanted.add(includeInactive);
      const cached = this.cache.get(includeInactive);
      if (cached) {
         // old but not invalidated: serve it now, refresh behind it
         if (Date.now() - cached.builtAt >= MAX_AGE_MS) void this.start(includeInactive);
         return right(cached);
      }
      return this.start(includeInactive);
   }

   // concurrent callers share one build: a cold cache with ten tabs open is one query, not ten
   private start(includeInactive: boolean): Promise<Either<BaseAppError, ProductSnapshot>> {
      let pending = this.building.get(includeInactive);
      if (!pending) {
         pending = this.build(includeInactive).finally(() => this.building.delete(includeInactive));
         this.building.set(includeInactive, pending);
      }
      return pending;
   }

   private async build(includeInactive: boolean): Promise<Either<BaseAppError, ProductSnapshot>> {
      const version = this.version;
      const t0 = performance.now();
      const result = await this.productRepository.getSnapshotRows(includeInactive);
      if (result.isLeft()) return left(new ServerError("500", true, "internal server error", result.value));
      const rows = result.value;
      const t1 = performance.now();

      const n = rows.length;
      const num = (pick: (i: number) => number | string) => Float64Array.from({ length: n }, (_, i) => Number(pick(i)));
      // dictionaries keep first-seen order (compare: false): rows already come sorted, so sorting the
      // strings again here would cost seconds for nothing
      const buffer = encodeColumnar(
         n,
         [
            { name: "id", type: "dict", strings: rows.map((r) => r.id), compare: false },
            { name: "name", type: "dict", strings: rows.map((r) => r.name), compare: false },
            { name: "sku", type: "dict", strings: rows.map((r) => r.sku), compare: false },
            { name: "categoria", type: "dict", strings: rows.map((r) => r.categoria), compare: false },
            { name: "valor_de_custo", type: "f64", values: num((i) => rows[i].valorDeCusto) },
            { name: "icms", type: "f64", values: num((i) => rows[i].icms) },
            { name: "valor_de_venda", type: "f64", values: num((i) => rows[i].valorDeVenda) },
            { name: "quantidade_em_estoque", type: "f64", values: num((i) => rows[i].quantidadeEmEstoque) },
            // epoch ms of the same Date the JSON endpoints turn into data_de_cadastro
            { name: "data_de_cadastro", type: "f64", values: Float64Array.from(rows, (r) => r.dataDeCadastro.getTime()) },
            { name: "ativo", type: "u8", values: Uint8Array.from(rows, (r) => (r.ativo ? 1 : 0)) },
         ],
         { source: "sample-erp/products", includeInactive, builtAt: new Date().toISOString() },
      );
      const t2 = performance.now();
      const raw = Buffer.from(buffer);
      // level 1: most of the gain on this data at a fraction of the time of the default level
      const gzip = gzipSync(raw, { level: 1 });
      const t3 = performance.now();

      const snapshot: ProductSnapshot = {
         gzip,
         bytes: raw.byteLength,
         rows: n,
         etag: `"${createHash("sha1").update(gzip).digest("base64url")}"`,
         builtAt: Date.now(),
      };
      // a write during the build means this snapshot may already be out of date: serve it, don't keep it
      if (version === this.version) this.cache.set(includeInactive, snapshot);
      emitApi("product-snapshot", {
         rows: n,
         bytes: raw.byteLength,
         gzipBytes: gzip.byteLength,
         includeInactive,
         queryMs: t1 - t0,
         encodeMs: t2 - t1,
         gzipMs: t3 - t2,
      });
      return right(snapshot);
   }
}

export default ProductSnapshotService;
