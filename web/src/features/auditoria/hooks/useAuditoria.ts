import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { getAuditorias, getAuditoriaById, createAuditoria, archiveAuditoria, deleteAuditoria } from "../api/auditoria.api";

// keeps the current page on screen while the next one loads
export const useAuditorias = (page = 1, amount = LIST_PAGE_SIZE) =>
  useQuery({
    queryKey: ["auditorias", "list", page, amount],
    queryFn: () => getAuditorias(page, amount),
    placeholderData: keepPreviousData,
  });

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
