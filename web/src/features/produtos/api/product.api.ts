import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { CreateProductPayload, UpdateProductPayload, Product } from "../types/produto.types";
import { ImportRow, ImportRowError } from "../utils/productsImport";

export const getProducts = (page: number, amount: number) =>
  apiClient.get<ListResponse<Product>>("/products", { params: { page, amount } }).then((r) => r.data);
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
