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
export const getProductsByFilter = (params: Record<string, string>) =>
  apiClient.get<ListResponse<Product>>("/products/filter", { params }).then((r) => r.data.data);
export const createProduct = (payload: CreateProductPayload) => apiClient.post("/products", payload);
export const updateProduct = (payload: UpdateProductPayload) => apiClient.put(`/products/${payload.id}`, payload);
export const deactivateProduct = (id: string) => apiClient.patch(`/products/${id}/deactivate`);
export const deleteProduct = (id: string) => apiClient.delete(`/products/${id}`);
