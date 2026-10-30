import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LAZY_PAGE_SIZE, nextLazyPage } from "../../../lib/pagination";
import { getAuditorias, getAuditoriaById, createAuditoriaManual, archiveAuditoria, deleteAuditoria } from "../api/auditoria.api";

export const useAuditorias = () =>
  useInfiniteQuery({
    queryKey: ["auditorias", "list"],
    queryFn: ({ pageParam }) => getAuditorias(pageParam, LAZY_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: nextLazyPage,
  });

export const useAuditoria = (id: string) =>
  useQuery({ queryKey: ["auditorias", id], queryFn: () => getAuditoriaById(id), enabled: !!id });

export const useCreateAuditoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAuditoriaManual,
    // the audited product/categoria changed too
    onSuccess: () =>
      Promise.all(
        ["auditorias", "products", "categorias"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
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
