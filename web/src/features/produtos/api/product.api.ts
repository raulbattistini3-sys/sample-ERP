import { ListFilterParams } from "../../../hooks/useListFilters";
import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { productSocket, SocketUnavailable } from "../../../lib/productSocket";
import { telemetry } from "../../../lib/telemetry";
import type { Filtros, Produto } from "../../../gen/produtos/v1/busca";
import { CreateProductPayload, UpdateProductPayload, Product } from "../types/produto.types";
import { ImportRow, ImportRowError } from "../utils/productsImport";

export const getProducts = (page: number, amount: number) =>
  apiClient.get<ListResponse<Product>>("/products", { params: { page, amount } }).then((r) => r.data);
// a scroll has no total: nextCursor is null on the last load
export type ProductsScrollPage = { data: Product[]; pageSize: number; nextCursor: string | null };
const getProductsScrollRest = (cursor: string | undefined, amount: number, filters: ListFilterParams = {}) =>
  apiClient.get<ProductsScrollPage>("/products/scroll", { params: { cursor, amount, ...filters } });

export type ProductsTransport = "rest" | "socket";
const TRANSPORTS: ProductsTransport[] = ["rest", "socket"];

// ?transport=rest|socket on the page, else VITE_PRODUCTS_TRANSPORT, else REST
export function productsTransport(): ProductsTransport {
  const fromUrl = new URLSearchParams(window.location.search).get("transport") as ProductsTransport | null;
  if (fromUrl && TRANSPORTS.includes(fromUrl)) return fromUrl;
  const fromEnv = import.meta.env.VITE_PRODUCTS_TRANSPORT as ProductsTransport | undefined;
  return fromEnv && TRANSPORTS.includes(fromEnv) ? fromEnv : "rest";
}

const first = (v: string[] | undefined) => v?.[0] ?? "";
const toFiltros = (f: ListFilterParams): Filtros => ({
  categoria: f.categoria ?? [],
  icms: f.icms ?? [],
  status: f.status ?? [],
  busca: first(f.busca),
  buscaPor: first(f.busca_por),
  cadastroDesde: first(f.cadastro_desde),
  cadastroAntes: first(f.cadastro_antes),
});
// the JSON shape of GET /products/scroll, so the list doesn't know which transport it came from
const fromProduto = (p: Produto): Product => ({
  id: p.id,
  name: p.name,
  ativo: p.ativo,
  sku: p.sku,
  categoria: { ...p.categoria, nome: (p.categoria?.nome ?? "") as Product["categoria"]["nome"] },
  valor_de_custo: p.valorDeCusto,
  icms: p.icms,
  valor_de_venda: p.valorDeVenda,
  data_de_cadastro: p.dataDeCadastro,
  quantidade_em_estoque: p.quantidadeEmEstoque,
});

// the first request of each transport in this page load: the cold run (connection, JIT, caches)
const seen = new Set<ProductsTransport>();

// One page of the list over the chosen transport. The socket falls back to REST when it can't be used;
// either way one telemetry event says which transport answered and what it cost (timings and sizes only,
// never the filters or the rows).
export async function getProductsScroll(cursor: string | undefined, amount: number, filters: ListFilterParams = {}): Promise<ProductsScrollPage> {
  const requested = productsTransport();
  const t0 = performance.now();
  const report = (transport: ProductsTransport, data: Record<string, unknown>) => {
    const cold = !seen.has(transport);
    seen.add(transport);
    telemetry().emit({
      source: "transport",
      type: "request",
      ts: performance.now(),
      data: { endpoint: "products/scroll", requested, transport, cold, ms: performance.now() - t0, page: cursor ? "next" : "first", ...data },
    });
  };

  if (requested === "socket") {
    try {
      const { pagina, connectMs, bytes } = await productSocket.buscar(cursor, amount, toFiltros(filters));
      report("socket", { ok: true, connectMs, bytes, rows: pagina.produtos.length });
      return { data: pagina.produtos.map(fromProduto), pageSize: pagina.pageSize, nextCursor: pagina.nextCursor || null };
    } catch (err) {
      if (!(err instanceof SocketUnavailable)) {
        report("socket", { ok: false, status: (err as { status?: number }).status ?? null });
        throw err;
      }
      // fall through to REST, recorded as a fallback
      report("socket", { ok: false, fallback: true, reason: err.message });
    }
  }

  const t1 = performance.now();
  try {
    const res = await getProductsScrollRest(cursor, amount, filters);
    const length = Number(res.headers["content-length"]);
    report("rest", { ok: true, restMs: performance.now() - t1, bytes: Number.isFinite(length) ? length : null, rows: res.data.data.length });
    return res.data;
  } catch (err) {
    report("rest", { ok: false, status: (err as { response?: { status?: number } }).response?.status ?? null });
    throw err;
  }
}
export const getProductById = (id: string) =>
  apiClient.get<ItemResponse<Product>>(`/products/${id}`).then((r) => r.data.data);
// same products as the list, plus the sum of valor_de_venda per categoria over all of them
export type ProductsDownloadPage = ListResponse<Product> & { aggregated_value: Record<string, number> };
export const getProductsDownloadPage = (page: number, amount: number) =>
  apiClient.get<ProductsDownloadPage>("/products/download", { params: { page, amount } }).then((r) => r.data);
// ADM/SU; all rows are saved or none. 422 carries the errors per line, so it's read as data
export type ImportProductsResult = { created: number; updated: number; errors: ImportRowError[] };
export const importProducts = (rows: ImportRow[]) =>
  apiClient
    .post<ImportProductsResult>("/products/import", { rows }, { validateStatus: (status) => status === 200 || status === 422 })
    .then((r) => r.data);
// Imports through the importer (ADM/SU): the file goes as chosen and is read, checked and saved on the server.
// POST answers 202 right away; the import is then polled until it reaches a final status. A 503 means the
// Go importer isn't reachable: import the rows with importProducts instead.
export type ProductImportStatus = "pendente" | "processando" | "concluida" | "rejeitada" | "falhou";
export type ProductImport = {
  id: string;
  status: ProductImportStatus;
  nome_arquivo: string;
  total_linhas: number;
  linhas_importadas: number;
  linhas_criadas: number;
  linhas_atualizadas: number;
  // rejeitada: one entry per problem, so a line can appear more than once
  erros: { linha: number; campo: string; mensagem: string }[];
  // falhou, or rejeitada for a reason that isn't one line's
  mensagem: string;
  criada_em: string | null;
  finalizada_em: string | null;
};
export const isProductImportFinished = (status: ProductImportStatus) =>
  status === "concluida" || status === "rejeitada" || status === "falhou";
export const startProductImport = (file: File) => {
  const form = new FormData();
  form.append("planilha", file);
  // the client defaults to JSON, and axios would turn a FormData into JSON under that Content-Type;
  // multipart/form-data makes it send the form, with the browser adding the boundary
  return apiClient
    .post<ItemResponse<ProductImport>>("/products/imports", form, { headers: { "Content-Type": "multipart/form-data" } })
    .then((r) => r.data.data);
};
export const getProductImport = (id: string) =>
  apiClient.get<ItemResponse<ProductImport>>(`/products/imports/${id}`).then((r) => r.data.data);
export const createProduct = (payload: CreateProductPayload) => apiClient.post("/products", payload);
export const updateProduct = (payload: UpdateProductPayload) => apiClient.put(`/products/${payload.id}`, payload);
export const deactivateProduct = (id: string) => apiClient.patch(`/products/${id}/deactivate`);
export const deleteProduct = (id: string) => apiClient.delete(`/products/${id}`);
