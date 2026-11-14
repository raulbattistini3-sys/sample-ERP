import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import {
  AlteracaoPagamentoMensal,
  NovoPagamentoMensal,
  acaoPagamentoMensal,
  createPagamentoMensal,
  getPagamentosMensais,
  updatePagamentoMensal,
} from "../api/recorrentes.api";

const KEY = ["cobrancas", "recorrentes"] as const;

// a cycle can be issued by the scheduler at any minute: refresh while the page is open
export const usePagamentosMensais = () => useQuery({ queryKey: KEY, queryFn: () => getPagamentosMensais(), refetchInterval: 60_000 });

export const useSalvarPagamentoMensal = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: (v: { id: null; novo: NovoPagamentoMensal } | { id: string; alteracao: AlteracaoPagamentoMensal }) =>
      "novo" in v ? createPagamentoMensal(v.novo) : updatePagamentoMensal(v.id, v.alteracao),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
};

export const useAcaoPagamentoMensal = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: ({ id, acao }: { id: string; acao: "pausar" | "retomar" | "cancelar" }) => acaoPagamentoMensal(id, acao),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
};
