import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { CreateDetalhamentoAuditoriaPayload, DetalhamentoAuditoria } from "../types/detalhamento_auditoria.types";

export const getDetalhamentosAuditoria = () =>
  apiClient.get<ListResponse<DetalhamentoAuditoria>>("/detalhamento-auditoria").then((r) => r.data.data);
export const getDetalhamentoAuditoriaById = (id: string) =>
  apiClient.get<ItemResponse<DetalhamentoAuditoria>>(`/detalhamento-auditoria/${id}`).then((r) => r.data.data);
export const createDetalhamentoAuditoria = (payload: CreateDetalhamentoAuditoriaPayload) =>
  apiClient.post("/detalhamento-auditoria", payload);
export const deleteDetalhamentoAuditoria = (id: string) => apiClient.delete(`/detalhamento-auditoria/${id}`);
