import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import { emitirCobranca, getCobrancasPagas, getCobrancasRecentes, getLinhaDoTempo, getStripeConexao, sincronizarLinhaDoTempo } from "../api/cobrancas.api";

export const useStripeConexao = () => useQuery({ queryKey: ["stripe", "conexao"], queryFn: getStripeConexao });

// polls every 3 s while a backfill runs, then stops
export const useLinhaDoTempo = () =>
  useQuery({
    queryKey: ["cobrancas", "linha-do-tempo"],
    queryFn: getLinhaDoTempo,
    refetchInterval: (query) => (query.state.data?.rodando ? 3000 : false),
  });

export const useSincronizarLinhaDoTempo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sincronizarLinhaDoTempo,
    onSuccess: (estado) => queryClient.setQueryData(["cobrancas", "linha-do-tempo"], estado),
  });
};

// the paid invoices, a page at a time ("Carregar mais"); the event stream refreshes the first page
export const useCobrancasPagas = (limite: number) =>
  useInfiniteQuery({
    queryKey: ["cobrancas", "pagas", limite],
    queryFn: ({ pageParam }) => getCobrancasPagas(pageParam, limite),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima.proxima,
    retry: false,
  });

export const useCobrancasRecentes = () => useQuery({ queryKey: ["cobrancas", "recentes"], queryFn: getCobrancasRecentes, retry: false });

// single flight: a double click must not bill the selected clients twice (the gateway's Idempotency-Key
// covers retries of the same request)
export const useEmitirCobranca = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: emitirCobranca,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cobrancas"] });
      queryClient.invalidateQueries({ queryKey: ["stripe"] });
    },
  });
};
