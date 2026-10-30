import { useQuery } from "@tanstack/react-query";
import { getDetalhamentoAuditoriaById } from "../api/detalhamento_auditoria.api";

export const useDetalhamentoAuditoria = (id: string) =>
  useQuery({ queryKey: ["detalhamentos-auditoria", id], queryFn: () => getDetalhamentoAuditoriaById(id), enabled: !!id });
