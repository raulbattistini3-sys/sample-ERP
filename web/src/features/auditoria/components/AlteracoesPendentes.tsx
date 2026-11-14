import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import { apiClient, getApiErrorMessage, ItemResponse } from "../../../lib/api-client";

type Pendentes = { total: number; desde: string | null; ultima: string | null; proxima: string | null; intervaloMinutos: number };
type Consolidacao = { pendentes: number; auditorias: number; lotes: number };

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// Automatic auditorias are made in batches every few minutes (one per user and action, see the API's
// AuditoriaConsolidacaoWorker): this line says how many changes are waiting and lets an admin run it now.
export const AlteracoesPendentes = () => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["auditorias", "pendentes"],
    queryFn: () => apiClient.get<ItemResponse<Pendentes>>("/auditoria/pendentes").then((r) => r.data.data),
    refetchInterval: 30_000,
  });
  const gerar = useSingleFlightMutation({
    mutationFn: () => apiClient.post<ItemResponse<Consolidacao>>("/auditoria/pendentes/consolidar").then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auditorias"] }),
  });

  if (!data) return null;
  const resultado = gerar.data;
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200"
      data-testid="auditorias-pendentes"
    >
      <Clock className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {data.total === 0
          ? `Auditorias automáticas são geradas a cada ${data.intervaloMinutos} min, agrupadas por usuário e ação.`
          : `${data.total} ${data.total === 1 ? "alteração aguardando" : "alterações aguardando"} a próxima auditoria automática${
              data.proxima ? ` (por volta das ${hora(data.proxima)})` : ""
            }.`}
        {resultado && ` Gerado agora: ${resultado.auditorias} auditoria(s) em ${resultado.lotes} lote(s).`}
        {gerar.error && <span className="text-red-600"> {getApiErrorMessage(gerar.error, "Não foi possível gerar agora.")}</span>}
      </p>
      {data.total > 0 && (
        <Button size="sm" variant="secondary" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
          {gerar.isPending ? "Gerando…" : "Gerar agora"}
        </Button>
      )}
    </div>
  );
};
