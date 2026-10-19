import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCategorias, createCategoria, archiveCategoria } from "../api/categorias.api";

export const useCategorias = () =>
  useQuery({ queryKey: ["categorias"], queryFn: getCategorias });

export const useCreateCategoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};

export const useArchiveCategoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};
