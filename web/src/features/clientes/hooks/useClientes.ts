import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { getClientes, getEmpresas, sincronizarClientes } from "../api/clientes.api";

// keeps the current page on screen while the next one loads
export const useClientes = (page: number, busca: string, enabled: boolean) =>
  useQuery({
    queryKey: ["clientes", "lista", page, busca],
    queryFn: () => getClientes(page, LIST_PAGE_SIZE, busca),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useEmpresas = (page: number, busca: string, decisores: boolean, enabled: boolean) =>
  useQuery({
    queryKey: ["clientes", "empresas", page, busca, decisores],
    queryFn: () => getEmpresas(page, LIST_PAGE_SIZE, busca, decisores),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useSincronizarClientes = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sincronizarClientes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clientes"] }),
  });
};
