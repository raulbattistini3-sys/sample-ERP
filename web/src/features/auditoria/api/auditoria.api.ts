import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { CreateAuditoriaManualPayload, Auditoria } from "../types/auditoria.types";

export const getAuditorias = (page: number, amount: number) =>
  apiClient.get<ListResponse<Auditoria>>("/auditoria", { params: { page, amount } }).then((r) => r.data);
export const getAuditoriaById = (id: string) =>
  apiClient.get<ItemResponse<Auditoria>>(`/auditoria/${id}`).then((r) => r.data.data);
// applies the changes to the audited product/categoria and records them
export const createAuditoriaManual = (payload: CreateAuditoriaManualPayload) =>
  apiClient.post<Auditoria>("/auditoria/manual", payload).then((r) => r.data);
export const archiveAuditoria = (id: string) => apiClient.patch(`/auditoria/${id}/archive`);
export const deleteAuditoria = (id: string) => apiClient.delete(`/auditoria/${id}`);
