import { apiClient } from "../../../lib/api-client";
import { CreateAuditoriaPayload, Auditoria } from "../types/auditoria.types";

export const getAuditorias = () => apiClient.get<Auditoria[]>("/auditoria");
export const getAuditoriaById = (id: string) => apiClient.get<Auditoria>(`/auditoria/${id}`);
export const createAuditoria = (payload: CreateAuditoriaPayload) => apiClient.post("/auditoria", payload);
export const archiveAuditoria = (id: string) => apiClient.patch(`/auditoria/${id}/archive`);
export const deleteAuditoria = (id: string) => apiClient.delete(`/auditoria/${id}`);
