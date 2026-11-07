import { CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { FormCard } from "../../../components/ui/PageState";
import { formatDateTime } from "../../../lib/form";
import { useStripeConexao } from "../hooks/useCobrancas";

// The Stripe card on Integrações: asks Stripe live (through billing) whether it's connected, shows the
// latest events as a log, and when it isn't connected says what's missing; "Conectar" checks again.
export function StripeCard() {
  const { data, isLoading, isFetching, refetch, error } = useStripeConexao();
  const conectado = !!data?.status?.conectado;
  const status = data?.status;

  const problema = !data
    ? null
    : !data.configurado
      ? "O ERP não sabe onde está o serviço de cobranças: defina BILLING_URL (e BILLING_INTERNAL_TOKEN) na API. O launcher faz isso sozinho quando config/billing.env existe."
      : !data.alcancavel
        ? `O serviço de cobranças (billing) não respondeu${data.erro ? `: ${data.erro}` : "."} Ele precisa estar rodando.`
        : !status?.conectado
          ? `${status?.erro ?? "O Stripe recusou a conexão."} Confira SANDBOX_STRIPE_API_KEY em billing/.env (ou config/billing.env no launcher).`
          : null;

  return (
    <FormCard className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            Stripe
            {data &&
              (conectado ? (
                <CheckCircle2 className="h-4 w-4 text-accent" aria-label="Conectado" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" aria-label="Não conectado" />
              ))}
          </h3>
          {isLoading ? (
            <p className="mt-1 text-sm text-muted">Verificando a conexão...</p>
          ) : error ? (
            <p className="mt-1 text-sm text-red-700">Não foi possível perguntar à API.</p>
          ) : conectado && status?.conta ? (
            <p className="mt-1 text-sm text-muted">
              Conectado à conta{" "}
              <a
                href={`https://dashboard.stripe.com/${status.modoTeste ? "test/" : ""}dashboard`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                {status.conta.nome || status.conta.id}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>{" "}
              ({status.conta.pais ?? "?"}, {status.conta.moeda?.toUpperCase() ?? "?"}),{" "}
              {status.modoTeste ? "modo de teste" : "modo de produção"}.{" "}
              {status.webhookConfigurado ? "Webhook configurado." : "Webhook sem segredo: STRIPE_WEBHOOK_SECRET."}
              {!status.conta.cobrancasAtivas && " A conta ainda não pode receber pagamentos."}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Não conectado. {problema}</p>
          )}
        </div>
        <Button variant={conectado ? "ghost" : "primary"} onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {conectado ? "Atualizar" : "Conectar"}
        </Button>
      </div>

      {conectado && (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-sm font-semibold text-ink">Últimos eventos do Stripe</h4>
          {data?.eventos.length ? (
            <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto text-sm" aria-label="Eventos do Stripe">
              {data.eventos.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
                  <span className="font-mono text-xs text-ink">{e.tipo}</span>
                  <span className="text-xs text-muted">{formatDateTime(e.criadoEm)}</span>
                  {e.resumo && <span className="w-full text-xs text-muted">{e.resumo}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nenhum evento ainda. Emita uma cobrança e ele aparece aqui.</p>
          )}
          {data?.erro && <p className="mt-2 text-xs text-red-700">Eventos indisponíveis: {data.erro}</p>}
        </div>
      )}
    </FormCard>
  );
}
