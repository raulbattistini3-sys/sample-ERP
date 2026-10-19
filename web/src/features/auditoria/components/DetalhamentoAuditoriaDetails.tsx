import { ArrowRight } from "lucide-react";
import { useDetalhamentoAuditoria } from "../hooks/useDetalhamentoAuditoria";
import { formatCurrency } from "../utils/format";

export function DetalhamentoAuditoriaDetails({ id }: { id: string }) {
  const { data: detalhamento, isLoading, error } = useDetalhamentoAuditoria(id);

  if (isLoading) return <p className="text-sm text-muted">Carregando...</p>;
  if (error || !detalhamento) return <p className="text-sm text-danger">Erro ao carregar o detalhamento.</p>;

  const diferenca = Number(detalhamento.valor_atual) - Number(detalhamento.valor_anterior);

  return (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-muted">Produto</dt>
        <dd className="font-medium text-ink">{detalhamento.nome_do_produto}</dd>
      </div>
      <div>
        <dt className="text-muted">Valor</dt>
        <dd className="flex flex-wrap items-center gap-2 text-ink">
          <span>{formatCurrency(detalhamento.valor_anterior)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted" aria-label="para" />
          <span className="font-medium">{formatCurrency(detalhamento.valor_atual)}</span>
          {diferenca !== 0 && (
            <span className={diferenca > 0 ? "text-accent" : "text-danger"}>
              ({diferenca > 0 ? "+" : "−"}
              {formatCurrency(Math.abs(diferenca))})
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-muted">Observações adicionais</dt>
        <dd className="whitespace-pre-wrap text-ink">{detalhamento.observacoes_adicionais || "—"}</dd>
      </div>
    </dl>
  );
}
