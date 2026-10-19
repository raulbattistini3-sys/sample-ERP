import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useCreateAuditoria } from "../hooks/useAuditoria";
import { useDeleteDetalhamentoAuditoria } from "../hooks/useDetalhamentoAuditoria";
import { Button } from "../../../components/ui/Button";
import { Field, inputClassName } from "../../../components/ui/Field";
import { DetalhamentoAuditoriaFormModal } from "../components/DetalhamentoAuditoriaFormModal";
import { AcaoEfetuadaEnum, Auditoria, CreateAuditoriaSchema } from "../types/auditoria.types";
import { DetalhamentoAuditoria } from "../types/detalhamento_auditoria.types";
import { acaoLabels, formatCurrency } from "../utils/format";

// value for <input type="datetime-local"> in the user's timezone
const nowLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function AuditoriaFormPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const createAuditoria = useCreateAuditoria();
  const deleteDetalhamento = useDeleteDetalhamentoAuditoria();

  const [acao, setAcao] = useState<Auditoria["acao_efetuada"]>("Criacao");
  const [dataDeAudicao, setDataDeAudicao] = useState(nowLocal);
  const [detalhamento, setDetalhamento] = useState<DetalhamentoAuditoria | null>(null);
  const [detalhamentoModalOpen, setDetalhamentoModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const removeDetalhamento = () => {
    if (!detalhamento) return;
    // the detalhamento was already persisted when the modal saved it — don't leave it orphaned
    deleteDetalhamento.mutate(detalhamento.id, { onSuccess: () => setDetalhamento(null) });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      setFormError("Sessão sem usuário autenticado. Faça login novamente.");
      return;
    }
    const date = new Date(dataDeAudicao);
    if (Number.isNaN(date.getTime())) {
      setFormError("Informe uma data válida.");
      return;
    }
    const parsed = CreateAuditoriaSchema.safeParse({
      acao_efetuada: acao,
      data_de_audicao: date.toISOString(),
      nome_do_auditor: user.id,
      detalhamento_auditoria_id: detalhamento?.id ?? null,
    });
    if (!parsed.success) {
      setFormError("Verifique os campos da auditoria.");
      return;
    }
    setFormError(null);
    createAuditoria.mutate(parsed.data, { onSuccess: () => navigate("/auditoria") });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" className="mb-4 -ml-3" onClick={() => navigate("/auditoria")}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Voltar
      </Button>
      <h2 className="mb-4 text-lg font-semibold text-ink">Nova auditoria</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-4 rounded-md border border-border bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ação efetuada" htmlFor="acao_efetuada">
              <select
                id="acao_efetuada"
                className={inputClassName}
                value={acao}
                onChange={(e) => setAcao(e.target.value as Auditoria["acao_efetuada"])}
              >
                {AcaoEfetuadaEnum.options.map((option) => (
                  <option key={option} value={option}>
                    {acaoLabels[option]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data da auditoria" htmlFor="data_de_audicao">
              <input
                id="data_de_audicao"
                type="datetime-local"
                className={inputClassName}
                value={dataDeAudicao}
                onChange={(e) => setDataDeAudicao(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Auditor" htmlFor="nome_do_auditor">
            <input id="nome_do_auditor" className={inputClassName} value={user?.nome ?? ""} disabled />
          </Field>
        </section>

        <section className="rounded-md border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Detalhamento</h3>
            {!detalhamento && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setDetalhamentoModalOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Adicionar detalhamento
              </Button>
            )}
          </div>
          {detalhamento ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-canvas p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{detalhamento.nome_do_produto}</p>
                <p className="text-muted">
                  {formatCurrency(detalhamento.valor_anterior)} → {formatCurrency(detalhamento.valor_atual)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeDetalhamento}
                disabled={deleteDetalhamento.isPending}
                aria-label="Remover detalhamento"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">Opcional — registre o produto e os valores alterados.</p>
          )}
        </section>

        {(formError || createAuditoria.isError) && (
          <p className="text-sm text-danger">{formError ?? "Não foi possível salvar a auditoria."}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate("/auditoria")}>
            Cancelar
          </Button>
          <Button type="submit" disabled={createAuditoria.isPending}>
            {createAuditoria.isPending ? "Salvando..." : "Salvar auditoria"}
          </Button>
        </div>
      </form>

      <DetalhamentoAuditoriaFormModal
        open={detalhamentoModalOpen}
        onClose={() => setDetalhamentoModalOpen(false)}
        onCreated={setDetalhamento}
      />
    </div>
  );
}
