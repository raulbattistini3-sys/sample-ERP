import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { LAZY_PAGE_SIZE, nextLazyPage } from "../../../lib/pagination";
import { getClientes, getEmpresas } from "../api/clientes.api";

// keeps the current rows on screen while the next search loads
export const useClientes = (busca: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["clientes", "lista", busca],
    queryFn: ({ pageParam }) => getClientes(pageParam, LAZY_PAGE_SIZE, busca),
    initialPageParam: 1,
    getNextPageParam: nextLazyPage,
    placeholderData: keepPreviousData,
    enabled,
  });

export const useEmpresas = (busca: string, decisores: boolean, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["clientes", "empresas", busca, decisores],
    queryFn: ({ pageParam }) => getEmpresas(pageParam, LAZY_PAGE_SIZE, busca, decisores),
    initialPageParam: 1,
    getNextPageParam: nextLazyPage,
    placeholderData: keepPreviousData,
    enabled,
  });
