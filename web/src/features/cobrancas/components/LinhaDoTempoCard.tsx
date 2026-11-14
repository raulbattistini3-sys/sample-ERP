import { History, MessageCircle } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, FormCard } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatDateTime } from "../../../lib/form";
import { useLinhaDoTempo, useSincronizarLinhaDoTempo } from "../hooks/useCobrancas";

// Each new cobrança (one-time or Pagamento mensal) and each payment leaves a note on the client's HubSpot
// timeline. This card writes the notes for the invoices billed before that existed: it reads every invoice
// in Stripe and adds the missing ones (an invoice already noted is skipped, so running it twice is safe).
export function LinhaDoTempoCard() {
  const estado = useLinhaDoTempo();
  const sincronizar = useSincronizarLinhaDoTempo();
  const s = estado.data;

  return (
    <FormCard className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <History className="h-4 w-4 text-accent" aria-hidden="true" /> Linha do tempo no HubSpot
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Cada cobrança emitida e cada pagamento viram uma nota na linha do tempo do cliente e da empresa no HubSpot, e o
            pagamento move a empresa para <strong>Cliente</strong> no funil. Para as cobranças antigas, sincronize uma vez.
          </p>
        </div>
        <Button variant="secondary" onClick={() => sincronizar.mutate()} disabled={s?.rodando || sincronizar.isPending}>
          {s?.rodando ? "Sincronizando..." : "Sincronizar cobranças antigas"}
        </Button>
      </div>

      {estado.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(estado.error, "Não foi possível ler o estado da sincronização.")} />}
      {sincronizar.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(sincronizar.error, "Não foi possível começar a sincronização.")} />}

      {s && (s.rodando || s.terminadaEm) && (
        <div className="mt-3 rounded-md border border-border bg-canvas p-3 text-sm" aria-live="polite">
          <p className="text-ink">
            {s.rodando ? `Em andamento desde ${formatDateTime(s.iniciadaEm!)}` : `Última sincronização: ${formatDateTime(s.terminadaEm!)}`}
          </p>
          <p className="mt-1 text-xs text-muted">
            {s.faturas} fatura(s) lida(s) · {s.notas} nota(s) nova(s) · {s.pagas} paga(s) · {s.semCliente} sem cliente no HubSpot
          </p>
          {s.erros.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-red-700">
              {s.erros.map((erro, i) => (
                <li key={i}>{erro}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {s?.whatsappConfigurado
          ? "WhatsApp ligado: cada cobrança nova também vai por WhatsApp para o celular do cliente."
          : "WhatsApp desligado: configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID na API para enviar as cobranças também por WhatsApp."}
      </p>
    </FormCard>
  );
}
