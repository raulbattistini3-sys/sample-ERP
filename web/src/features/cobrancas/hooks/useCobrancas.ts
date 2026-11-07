import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import { emitirCobranca, getCobrancasRecentes, getStripeConexao } from "../api/cobrancas.api";

export const useStripeConexao = () => useQuery({ queryKey: ["stripe", "conexao"], queryFn: getStripeConexao });

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
