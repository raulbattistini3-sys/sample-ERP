import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCategorias,
  getCategoriaById,
  createCategoria,
  updateCategoria,
  archiveCategoria,
  deleteCategoria,
} from "../api/categorias.api";

export const useCategorias = () =>
  useQuery({ queryKey: ["categorias"], queryFn: getCategorias });

export const useCategoria = (id: string) =>
  useQuery({ queryKey: ["categorias", id], queryFn: () => getCategoriaById(id), enabled: !!id });

export const useCreateCategoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};

export const useUpdateCategoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCategoria,
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

export const useDeleteCategoria = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};
