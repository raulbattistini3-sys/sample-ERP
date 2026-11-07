import { ListFilterParams } from "../../../hooks/useListFilters";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
export const useCategorias = (page = 1, amount = LIST_PAGE_SIZE, filters: ListFilterParams = {}) =>
  useQuery({
    queryKey: ["categorias", "list", page, amount, filters],
    queryFn: () => getCategorias(page, amount, filters),
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
  return useSingleFlightMutation({
    mutationFn: createCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};

export const useUpdateCategoria = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: updateCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};

export const useArchiveCategoria = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: archiveCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};

export const useDeleteCategoria = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: deleteCategoria,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });
};
