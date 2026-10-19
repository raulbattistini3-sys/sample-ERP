import { apiClient } from "../../../lib/api-client";
import { CreateDetalhamentoAuditoriaPayload, DetalhamentoAuditoria } from "../types/detalhamento_auditoria.types";

export const getDetalhamentosAuditoria = () =>
  apiClient.get<{ data: DetalhamentoAuditoria[] }>("/detalhamento-auditoria").then((r) => r.data.data);
export const getDetalhamentoAuditoriaById = (id: string) =>
  apiClient.get<{ data: DetalhamentoAuditoria }>(`/detalhamento-auditoria/${id}`).then((r) => r.data.data);
// create responds with the created entity itself (no envelope) — its id links the auditoria
export const createDetalhamentoAuditoria = (payload: CreateDetalhamentoAuditoriaPayload) =>
  apiClient.post<DetalhamentoAuditoria>("/detalhamento-auditoria", payload).then((r) => r.data);
export const deleteDetalhamentoAuditoria = (id: string) => apiClient.delete(`/detalhamento-auditoria/${id}`);
