import { apiClient } from "../../../lib/api-client";
import { CreateAuditoriaPayload, Auditoria } from "../types/auditoria.types";

// the api wraps every read in a { data } envelope (BaseMessageGet / BaseMessageGetOne)
export const getAuditorias = () => apiClient.get<{ data: Auditoria[] }>("/auditoria").then((r) => r.data.data);
export const getAuditoriaById = (id: string) =>
  apiClient.get<{ data: Auditoria }>(`/auditoria/${id}`).then((r) => r.data.data);
export const createAuditoria = (payload: CreateAuditoriaPayload) => apiClient.post("/auditoria", payload);
export const archiveAuditoria = (id: string) => apiClient.patch(`/auditoria/${id}/archive`);
export const deleteAuditoria = (id: string) => apiClient.delete(`/auditoria/${id}`);
