import { apiClient } from "../../../lib/api-client";
import { CreateProductPayload, UpdateProductPayload, Product } from "../types/produto.types";

export const getProducts = () => apiClient.get<Product[]>("/products").then((r) => r.data);
export const getProductById = (id: string) => apiClient.get<Product>(`/products/${id}`).then((r) => r.data);
export const getProductsByFilter = (params: Record<string, string>) =>
  apiClient.get<Product[]>("/products/filter", { params }).then((r) => r.data);
export const createProduct = (payload: CreateProductPayload) => apiClient.post("/products", payload);
export const updateProduct = (payload: UpdateProductPayload) => apiClient.put(`/products/${payload.id}`, payload);
export const deactivateProduct = (id: string) => apiClient.patch(`/products/${id}/deactivate`);
export const deleteProduct = (id: string) => apiClient.delete(`/products/${id}`);
