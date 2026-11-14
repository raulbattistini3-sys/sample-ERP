import { useState } from "react";
import { ChevronDown, ExternalLink, Pause, Pencil, Play, Plus, XCircle } from "lucide-react";
import { PagamentoMensalIcon } from "./PagamentoMensalIcon";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, FormCard, LoadingState } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { PagamentoMensal, StatusPlano } from "../api/recorrentes.api";
import { useAcaoPagamentoMensal, usePagamentosMensais } from "../hooks/usePagamentosMensais";
import { formatDia, frequenciaLabel } from "../utils/valores";
import { PagamentoMensalModal } from "./PagamentoMensalModal";

const STATUS: Record<StatusPlano, { label: string; className: string }> = {
  ativo: { label: "Ativo", className: "bg-accent-soft text-accent" },
  pausado: { label: "Pausado", className: "bg-amber-50 text-amber-700" },
  encerrado: { label: "Encerrado", className: "bg-canvas text-muted" },
  cancelado: { label: "Cancelado", className: "bg-canvas text-muted" },
};

const CICLO: Record<string, { label: string; className: string }> = {
  emitida: { label: "Emitida", className: "text-accent" },
  falhou: { label: "Falhou", className: "text-red-700" },
  pulado: { label: "Não cobrada", className: "text-muted" },
};

const brl = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Plano({ plano, onEditar }: { plano: PagamentoMensal; onEditar: () => void }) {
  const acao = useAcaoPagamentoMensal();
  const [aberto, setAberto] = useState(false);
  const status = STATUS[plano.status];
  const vivo = plano.status === "ativo" || plano.status === "pausado";

  const executar = (tipo: "pausar" | "retomar" | "cancelar") => {
    if (tipo === "cancelar" && !window.confirm(`Cancelar o pagamento mensal "${plano.descricao}"? Nenhuma cobrança nova será emitida; as já emitidas continuam valendo.`)) return;
    acao.mutate({ id: plano.id, acao: tipo });
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{plano.cliente?.nome ?? `Contato ${plano.hubspotContatoId}`}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", status.className)}>{status.label}</span>
          </p>
          <p className="text-sm text-muted">
            {plano.descricao} · {brl(plano.valorCentavos)} · {frequenciaLabel(plano.intervalo, plano.unidade)}
          </p>
          <p className="text-xs text-muted">
            Máximo autorizado {brl(plano.valorMaximoCentavos)}
            {plano.valorMinimoCentavos !== null && ` · mínimo ${brl(plano.valorMinimoCentavos)}`}
            {plano.status === "ativo" && ` · próxima em ${formatDia(plano.proximaData)}`}
            {plano.dataFim && ` · até ${formatDia(plano.dataFim)}`}
          </p>
          {vivo && plano.ultimoErro && (
            <p className="mt-1 text-xs text-red-700">
              Última tentativa falhou{plano.tentativas > 0 ? ` (${plano.tentativas}ª, tentando de novo)` : ""}: {plano.ultimoErro}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {vivo && (
            <Button variant="ghost" size="sm" onClick={onEditar} disabled={acao.isPending}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Alterar
            </Button>
          )}
          {plano.status === "ativo" && (
            <Button variant="ghost" size="sm" onClick={() => executar("pausar")} disabled={acao.isPending}>
              <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pausar
            </Button>
          )}
          {plano.status === "pausado" && (
            <Button variant="ghost" size="sm" onClick={() => executar("retomar")} disabled={acao.isPending}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> Retomar
            </Button>
          )}
          {vivo && (
            <Button variant="ghost" size="sm" onClick={() => executar("cancelar")} disabled={acao.isPending}>
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cancelar
            </Button>
          )}
          {plano.ciclos.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-180")} aria-hidden="true" /> Histórico
            </Button>
          )}
        </div>
      </div>
      {acao.error && <ErrorAlert className="mt-2" message={getApiErrorMessage(acao.error, "Não foi possível alterar o pagamento.")} />}
      {aberto && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border text-xs">
          {plano.ciclos.map((c) => (
            <li key={c.ciclo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <span>
                {formatDia(c.dataReferencia)} · {brl(c.valorCentavos)} · <span className={CICLO[c.status]?.className}>{CICLO[c.status]?.label ?? c.status}</span>
                {c.erro && <span className="block text-muted">{c.erro}</span>}
              </span>
              {c.faturaUrl && (
                <a href={c.faturaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  Fatura {c.faturaNumero}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// the recurring charges (Pagamento mensal) on the Cobranças page
export function PagamentosMensais() {
  const { data, isLoading, error } = usePagamentosMensais();
  const [modal, setModal] = useState<{ plano: PagamentoMensal | null } | null>(null);

  return (
    <FormCard className="max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <PagamentoMensalIcon className="h-4 w-4 text-accent" aria-hidden="true" />
            Pagamentos mensais
          </h2>
          <p className="text-sm text-muted">Cobranças recorrentes: a fatura de cada data sai sozinha e vai por e-mail ao cliente.</p>
        </div>
        <Button size="sm" onClick={() => setModal({ plano: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo pagamento mensal
        </Button>
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorAlert message={getApiErrorMessage(error, "Não foi possível carregar os pagamentos mensais.")} />}
      {data && data.length === 0 && <p className="text-sm text-muted">Nenhum pagamento mensal ainda.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.map((p) => (
            <Plano key={p.id} plano={p} onEditar={() => setModal({ plano: p })} />
          ))}
        </ul>
      )}
      <PagamentoMensalModal open={modal !== null} plano={modal?.plano ?? null} onClose={() => setModal(null)} />
    </FormCard>
  );
}
