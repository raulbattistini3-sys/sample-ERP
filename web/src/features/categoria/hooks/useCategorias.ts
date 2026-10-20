import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ALL_ITEMS_AMOUNT, LIST_PAGE_SIZE } from "../../../lib/pagination";
import {
  getCategorias,
  getCategoriaById,
  createCategoria,
  updateCategoria,
  archiveCategoria,
  deleteCategoria,
} from "../api/categorias.api";

// keeps the current page on screen while the next one loads
export const useCategorias = (page = 1, amount = LIST_PAGE_SIZE) =>
  useQuery({
    queryKey: ["categorias", "list", page, amount],
    queryFn: () => getCategorias(page, amount),
    placeholderData: keepPreviousData,
  });

// active categoria names for selects; pages get a plain string[] instead of a list page
export const useCategoriaNomes = () =>
  useQuery({
    queryKey: ["categorias", "nomes"],
    queryFn: () => getCategorias(1, ALL_ITEMS_AMOUNT),
    select: (result) => result.data.filter((c) => c.ativo).map((c) => c.nome),
  });

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
