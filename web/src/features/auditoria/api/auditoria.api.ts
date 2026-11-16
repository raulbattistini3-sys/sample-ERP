import { ListFilterParams } from "../../../hooks/useListFilters";
import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { CreateAuditoriaManualPayload, Auditoria } from "../types/auditoria.types";

export const getAuditorias = (page: number, amount: number, filters: ListFilterParams = {}) =>
  apiClient.get<ListResponse<Auditoria>>("/auditoria", { params: { page, amount, ...filters } }).then((r) => r.data);
export const getAuditoriaById = (id: string) =>
  apiClient.get<ItemResponse<Auditoria>>(`/auditoria/${id}`).then((r) => r.data.data);
// applies the changes to the audited product/categoria and records them
export const createAuditoriaManual = (payload: CreateAuditoriaManualPayload) =>
  apiClient.post<Auditoria>("/auditoria/manual", payload).then((r) => r.data);
// "Baixar planilha": the API builds the CSV (one line per product and changed field); saved under its name
export const baixarPlanilhaAuditorias = async (params: Record<string, unknown> = {}) => {
  const r = await apiClient.get<Blob>("/auditoria/planilha", { params, responseType: "blob" });
  const nome = /filename="([^"]+)"/.exec(String(r.headers["content-disposition"] ?? ""))?.[1] ?? "auditorias.csv";
  const url = URL.createObjectURL(r.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const archiveAuditoria = (id: string) => apiClient.patch(`/auditoria/${id}/archive`);
export const deleteAuditoria = (id: string) => apiClient.delete(`/auditoria/${id}`);
