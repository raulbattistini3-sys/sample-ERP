import { dictString, tokenize } from "@pkg/tablecore/index.js";
import type { ListFilterParams } from "../../../hooks/useListFilters";
import type { Product } from "../types/produto.types";

type Dataset = import("@pkg/tablecore/types.js").Dataset;
type OpSpec = import("@pkg/tablecore/types.js").OpSpec;
type Filter = import("@pkg/tablecore/types.js").Filter;

// The list's filters (the same params the API's /products/scroll reads) as one operation of the shared
// core (pkg/tablecore): filters over the snapshot's typed arrays, no sort, because the snapshot is already
// in the list's order (name, id). Kept equivalent to ProductRepository.getProductsAfter, so a search
// finds the same products before the snapshot arrives (server) and after (here). The one addition is
// typo tolerance on names, which only the local engine has: a word the server finds nothing for.
export function toOpSpec(params: ListFilterParams): OpSpec {
  const filters: Filter[] = [];
  const text = params.busca?.[0]?.trim();
  if (text) {
    if (params.busca_por?.[0] === "sku") {
      // any part of the SKU, like ILIKE '%…%': a scan of the distinct SKUs, tested once each
      filters.push({ column: "sku", op: "contains", value: text });
    } else if (tokenize(text.toLowerCase()).length > 0) {
      // every word typed starts a word of the name (the inverted index: binary search over sorted terms,
      // then the posting lists); a word that starts none is matched by similarity instead (a typo, a
      // missing accent: trigram vectors, then edit distance), and the closest products come first
      filters.push({ column: "name", op: "fuzzy", value: text });
    } else {
      // no letters or digits ("%", "-"): the substring, as on the server
      filters.push({ column: "name", op: "contains", value: text });
    }
  }
  if (params.categoria?.length) filters.push({ column: "categoria", op: "in", value: params.categoria });
  if (params.icms?.length) filters.push({ column: "icms", op: "in", value: params.icms.map(Number) });
  // both or none is no filter; only ADM/SU have inactive products in their snapshot at all
  if (params.status?.length === 1) filters.push({ column: "ativo", op: "eq", value: params.status[0] === "ativo" });
  const desde = params.cadastro_desde?.[0];
  const antes = params.cadastro_antes?.[0];
  if (desde) filters.push({ column: "data_de_cadastro", op: "gte", value: Date.parse(desde) });
  // the API's "< antes"; timestamps are whole milliseconds
  if (antes) filters.push({ column: "data_de_cadastro", op: "lte", value: Date.parse(antes) - 1 });
  return { filters };
}

const f64 = (ds: Dataset, name: string) => ds.byName.get(name)!.values as Float64Array;

// Rows as the Product objects the table renders. Only the rows on screen are decoded: the rest stay
// integers in typed arrays, which is what keeps a 600k-row list cheap.
export function toProducts(ds: Dataset, indices: Uint32Array, count: number): Product[] {
  const id = ds.byName.get("id")!;
  const name = ds.byName.get("name")!;
  const sku = ds.byName.get("sku")!;
  const categoria = ds.byName.get("categoria")!;
  const custo = f64(ds, "valor_de_custo");
  const icms = f64(ds, "icms");
  const venda = f64(ds, "valor_de_venda");
  const estoque = f64(ds, "quantidade_em_estoque");
  const cadastro = f64(ds, "data_de_cadastro");
  const ativo = ds.byName.get("ativo")!.values;
  const text = (col: typeof id, row: number) => dictString(col.dict!, col.values[row]) ?? "";

  const n = Math.min(count, indices.length);
  const out: Product[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = indices[i];
    out[i] = {
      id: text(id, r),
      name: text(name, r),
      sku: text(sku, r),
      categoria: { nome: text(categoria, r) as Product["categoria"]["nome"] },
      valor_de_custo: custo[r],
      icms: icms[r],
      valor_de_venda: venda[r],
      quantidade_em_estoque: estoque[r],
      data_de_cadastro: new Date(cadastro[r]).toISOString(),
      ativo: ativo[r] === 1,
    };
  }
  return out;
}
