import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDetalhamentosAuditoria, getDetalhamentoAuditoriaById, createDetalhamentoAuditoria, deleteDetalhamentoAuditoria } from "../api/detalhamento_auditoria.api";

export const useDetalhamentosAuditoria = () =>
  useQuery({ queryKey: ["detalhamentos-auditoria"], queryFn: getDetalhamentosAuditoria });

export const useDetalhamentoAuditoria = (id: string) =>
  useQuery({ queryKey: ["detalhamentos-auditoria", id], queryFn: () => getDetalhamentoAuditoriaById(id), enabled: !!id });

export const useCreateDetalhamentoAuditoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createDetalhamentoAuditoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["detalhamentos-auditoria"] }),
  });
};

export const useDeleteDetalhamentoAuditoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDetalhamentoAuditoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["detalhamentos-auditoria"] }),
  });
};
