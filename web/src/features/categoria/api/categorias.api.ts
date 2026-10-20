// features/categorias/api/categoria.api.ts
import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { CreateCategoriaPayload, UpdateCategoriaPayload, Categoria } from "../types/categoria.types";

export const getCategorias = (page: number, amount: number) =>
  apiClient.get<ListResponse<Categoria>>("/categorias", { params: { page, amount } }).then((r) => r.data);
export const getCategoriaById = (id: string) =>
  apiClient.get<ItemResponse<Categoria>>(`/categorias/${id}`).then((r) => r.data.data);
export const createCategoria = (payload: CreateCategoriaPayload) => apiClient.post("/categorias", payload);
export const updateCategoria = (payload: UpdateCategoriaPayload) => apiClient.put(`/categorias/${payload.id}`, payload);
export const archiveCategoria = (id: string) => apiClient.patch(`/categorias/${id}/archive`);
export const deleteCategoria = (id: string) => apiClient.delete(`/categorias/${id}`);
