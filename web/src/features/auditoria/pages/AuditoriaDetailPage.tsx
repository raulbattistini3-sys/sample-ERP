import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useArchiveAuditoria, useAuditoria, useDeleteAuditoria } from "../hooks/useAuditoria";
import { useAuditorName } from "../hooks/useAuditorName";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { AcaoBadge } from "../components/AcaoBadge";
import { DetalhamentoAuditoriaDetails } from "../components/DetalhamentoAuditoriaDetails";
import { formatDateTime } from "../utils/format";

type PendingAction = "archive" | "delete" | null;

export function AuditoriaDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: auditoria, isLoading, error } = useAuditoria(id);
  const getAuditorName = useAuditorName();
  const archiveAuditoria = useArchiveAuditoria();
  const deleteAuditoria = useDeleteAuditoria();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const backToList = () => navigate("/auditoria");

  const confirmAction = () => {
    const mutation = pendingAction === "archive" ? archiveAuditoria : deleteAuditoria;
    mutation.mutate(id, { onSuccess: backToList });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" className="mb-4 -ml-3" onClick={backToList}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Voltar
      </Button>

      {isLoading ? (
        <p className="text-muted">Carregando...</p>
      ) : error || !auditoria ? (
        <p className="text-danger">Auditoria não encontrada.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Auditoria</h2>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPendingAction("archive")}>
                Arquivar
              </Button>
              <Button variant="danger" onClick={() => setPendingAction("delete")}>
                Excluir
              </Button>
            </div>
          </div>

          <section className="rounded-md border border-border bg-surface p-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Ação efetuada</dt>
                <dd className="mt-1">
                  <AcaoBadge acao={auditoria.acao_efetuada} />
                </dd>
              </div>
              <div>
                <dt className="text-muted">Data</dt>
                <dd className="mt-1 text-ink">{formatDateTime(auditoria.data_de_audicao)}</dd>
              </div>
              <div>
                <dt className="text-muted">Auditor</dt>
                <dd className="mt-1 text-ink">{getAuditorName(auditoria.nome_do_auditor)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-md border border-border bg-surface p-5">
            <h3 className="mb-4 text-sm font-semibold text-ink">Detalhamento</h3>
            {auditoria.detalhamento_auditoria_id ? (
              <DetalhamentoAuditoriaDetails id={auditoria.detalhamento_auditoria_id} />
            ) : (
              <p className="text-sm text-muted">Esta auditoria não possui detalhamento.</p>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmAction}
        title={pendingAction === "archive" ? "Arquivar auditoria" : "Excluir auditoria"}
        description={
          pendingAction === "archive"
            ? "A auditoria deixará de aparecer na listagem."
            : "Esta ação não pode ser desfeita. Deseja excluir a auditoria?"
        }
        confirmLabel={pendingAction === "archive" ? "Arquivar" : "Excluir"}
        destructive={pendingAction === "delete"}
        isPending={archiveAuditoria.isPending || deleteAuditoria.isPending}
      />
    </div>
  );
}
