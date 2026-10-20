import { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useBackToList } from "../../../hooks/useListPage";
import { Archive, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, FormCard, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatCurrency, formatDateTime } from "../../../lib/form";
import { useArchiveAuditoria, useAuditoria, useDeleteAuditoria } from "../hooks/useAuditoria";
import { useAuditorNames } from "../hooks/useAuditorNames";
import { useDetalhamentoAuditoria } from "../hooks/useDetalhamentoAuditoria";
import { acaoEfetuadaLabels } from "../types/auditoria.types";
import { AuditoriaJiraIssues } from "../../integracoes/components/AuditoriaJiraIssues";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

// decimals arrive as strings ("12.50")
const money = (value: string) => {
  const n = Number(value);
  return Number.isNaN(n) ? value : formatCurrency(n);
};

export const AuditoriaDetailPage = () => {
  const { id = "" } = useParams();
  const auditorNames = useAuditorNames();

  const { data: auditoria, isLoading, error } = useAuditoria(id);
  const detalhamentoQuery = useDetalhamentoAuditoria(auditoria?.detalhamento_auditoria_id ?? "");
  const archiveMutation = useArchiveAuditoria();
  const deleteMutation = useDeleteAuditoria();
  const backToList = useBackToList("/auditoria");

  if (isLoading) return <LoadingState />;
  if (error || !auditoria) return <ErrorAlert message={getApiErrorMessage(error, "Auditoria não encontrada.")} />;

  const handleArchive = () => {
    if (!window.confirm("Arquivar esta auditoria?")) return;
    archiveMutation.mutate(auditoria.id, { onSuccess: backToList });
  };

  const handleDelete = () => {
    if (!window.confirm("Excluir esta auditoria? Essa ação não pode ser desfeita.")) return;
    deleteMutation.mutate(auditoria.id, { onSuccess: backToList });
  };

  const mutationError = archiveMutation.error ?? deleteMutation.error;
  const detalhamento = detalhamentoQuery.data;

  return (
    <div>
      <PageHeader
        title="Detalhes da auditoria"
        actions={
          <>
            <Button variant="ghost" onClick={backToList}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar
            </Button>
            <Button variant="secondary" onClick={handleArchive} disabled={archiveMutation.isPending}>
              <Archive className="h-4 w-4" aria-hidden="true" />
              Arquivar
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Excluir
            </Button>
          </>
        }
      />

      {mutationError && (
        <ErrorAlert message={getApiErrorMessage(mutationError, "Não foi possível concluir a ação.")} className="mb-4 max-w-2xl" />
      )}

      <div className="space-y-4">
        <FormCard>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Ação">{acaoEfetuadaLabels[auditoria.acao_efetuada] ?? auditoria.acao_efetuada}</Detail>
            <Detail label="Data">{formatDateTime(auditoria.data_de_audicao)}</Detail>
            <Detail label="Auditor">{auditorNames.get(auditoria.usuario_id) ?? auditoria.usuario_id}</Detail>
          </dl>
        </FormCard>

        <FormCard>
          <h3 className="mb-4 text-sm font-semibold text-ink">Detalhamento</h3>
          {!auditoria.detalhamento_auditoria_id ? (
            <p className="text-sm text-muted">Esta auditoria não possui detalhamento.</p>
          ) : detalhamentoQuery.isLoading ? (
            <LoadingState />
          ) : !detalhamento ? (
            <ErrorAlert message={getApiErrorMessage(detalhamentoQuery.error, "Não foi possível carregar o detalhamento.")} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Produto">{detalhamento.nome_do_produto}</Detail>
              <Detail label="Valor anterior">{money(detalhamento.valor_anterior)}</Detail>
              <Detail label="Valor atual">{money(detalhamento.valor_atual)}</Detail>
              <div className="sm:col-span-3">
                <Detail label="Observações">
                  <span className="whitespace-pre-wrap">{detalhamento.observacoes_adicionais}</span>
                </Detail>
              </div>
            </dl>
          )}
        </FormCard>

        <AuditoriaJiraIssues auditoriaId={auditoria.id} />
      </div>
    </div>
  );
};
