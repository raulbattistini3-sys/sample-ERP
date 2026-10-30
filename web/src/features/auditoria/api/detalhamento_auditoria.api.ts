import { apiClient, ItemResponse } from "../../../lib/api-client";
import { DetalhamentoAuditoria } from "../types/detalhamento_auditoria.types";

export const getDetalhamentoAuditoriaById = (id: string) =>
  apiClient.get<ItemResponse<DetalhamentoAuditoria>>(`/detalhamento-auditoria/${id}`).then((r) => r.data.data);
