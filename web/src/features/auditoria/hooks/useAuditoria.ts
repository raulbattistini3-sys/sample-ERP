import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuditorias, getAuditoriaById, createAuditoria, archiveAuditoria, deleteAuditoria } from "../api/auditoria.api";

export const useAuditorias = () =>
  useQuery({ queryKey: ["auditorias"], queryFn: getAuditorias });

export const useAuditoria = (id: string) =>
  useQuery({ queryKey: ["auditorias", id], queryFn: () => getAuditoriaById(id), enabled: !!id });

export const useCreateAuditoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAuditoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auditorias"] }),
  });
};

export const useArchiveAuditoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveAuditoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auditorias"] }),
  });
};

export const useDeleteAuditoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAuditoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auditorias"] }),
  });
};
