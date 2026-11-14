import { useCallback, useMemo } from "react";
import { setorLabel } from "../utils/setores";
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { LAZY_PAGE_SIZE, nextLazyPage } from "../../../lib/pagination";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import {
  ClienteForm,
  EmpresaForm,
  createCliente,
  createEmpresa,
  getClientes,
  getClientesDaEmpresa,
  getEmpresa,
  getEmpresas,
  getSetores,
  updateCliente,
  updateEmpresa,
  vincularClientesAEmpresa,
} from "../api/clientes.api";

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

// `porPagina` companies at a time (the page's "Mostrar N por vez"); changing it starts the list over
export const useEmpresas = (busca: string, decisores: boolean, enabled: boolean, porPagina: number) =>
  useInfiniteQuery({
    queryKey: ["clientes", "empresas", busca, decisores, porPagina],
    queryFn: ({ pageParam }) => getEmpresas(pageParam, porPagina, busca, decisores),
    initialPageParam: 1,
    getNextPageParam: (ultima, paginas) => (paginas.length * porPagina < ultima.totalItems ? paginas.length + 1 : undefined),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useEmpresa = (id: string) =>
  useQuery({ queryKey: ["clientes", "empresa", id], queryFn: () => getEmpresa(id), enabled: !!id });

export const useClientesDaEmpresa = (id: string) =>
  useQuery({ queryKey: ["clientes", "da-empresa", id], queryFn: () => getClientesDaEmpresa(id), enabled: !!id });

export const useVincularClientes = (empresaId: string) => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: (clienteIds: string[]) => vincularClientesAEmpresa(empresaId, clienteIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clientes"] }),
  });
};

// HubSpot's industry values; they change rarely
export const useSetores = () => useQuery({ queryKey: ["clientes", "setores"], queryFn: getSetores, staleTime: 60 * 60 * 1000 });

// setor value → label shown to people (utils/setores.ts), HubSpot's own labels filling the gaps once loaded
export function useSetorLabel() {
  const { data } = useSetores();
  const hubspot = useMemo(() => new Map((data ?? []).map((s) => [s.value, s.label])), [data]);
  return useCallback((valor: string | null | undefined) => setorLabel(valor, hubspot), [hubspot]);
}

// creates (no id) or edits a client; both refresh every list of clients
export const useSalvarCliente = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: ({ id, form }: { id: string | null; form: ClienteForm }) => (id ? updateCliente(id, form) : createCliente(form)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clientes"] }),
  });
};

// the clients spreadsheet import lives in useImportacaoClientes.ts
export const useSalvarEmpresa = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: ({ id, form }: { id: string | null; form: EmpresaForm }) => (id ? updateEmpresa(id, form) : createEmpresa(form)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clientes"] }),
  });
};
