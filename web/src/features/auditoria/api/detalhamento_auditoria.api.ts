import { apiClient } from "../../../lib/api-client";
import { CreateDetalhamentoAuditoriaPayload, DetalhamentoAuditoria } from "../types/detalhamento_auditoria.types";

export const getDetalhamentosAuditoria = () => apiClient.get<DetalhamentoAuditoria[]>("/detalhamento-auditoria");
export const getDetalhamentoAuditoriaById = (id: string) =>
  apiClient.get<DetalhamentoAuditoria>(`/detalhamento-auditoria/${id}`);
export const createDetalhamentoAuditoria = (payload: CreateDetalhamentoAuditoriaPayload) =>
  apiClient.post("/detalhamento-auditoria", payload);
export const deleteDetalhamentoAuditoria = (id: string) => apiClient.delete(`/detalhamento-auditoria/${id}`);
