import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { getClientes, sincronizarClientes } from "../api/clientes.api";

// keeps the current page on screen while the next one loads
export const useClientes = (page: number, busca: string) =>
  useQuery({
    queryKey: ["clientes", page, busca],
    queryFn: () => getClientes(page, LIST_PAGE_SIZE, busca),
    placeholderData: keepPreviousData,
  });

export const useSincronizarClientes = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sincronizarClientes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clientes"] }),
  });
};
