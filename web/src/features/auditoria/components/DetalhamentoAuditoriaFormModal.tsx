import { FormEvent, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Field, inputClassName } from "../../../components/ui/Field";
import { useCreateDetalhamentoAuditoria } from "../hooks/useDetalhamentoAuditoria";
import { CreateDetalhamentoAuditoriaSchema, DetalhamentoAuditoria } from "../types/detalhamento_auditoria.types";

type FormValues = {
  nome_do_produto: string;
  valor_anterior: string;
  valor_atual: string;
  observacoes_adicionais: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

const emptyValues: FormValues = { nome_do_produto: "", valor_anterior: "", valor_atual: "", observacoes_adicionais: "" };

type DetalhamentoAuditoriaFormModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (detalhamento: DetalhamentoAuditoria) => void;
};

export function DetalhamentoAuditoriaFormModal({ open, onClose, onCreated }: DetalhamentoAuditoriaFormModalProps) {
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const createDetalhamento = useCreateDetalhamentoAuditoria();

  const set = (field: keyof FormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const close = () => {
    setValues(emptyValues);
    setErrors({});
    createDetalhamento.reset();
    onClose();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = CreateDetalhamentoAuditoriaSchema.safeParse({
      ...values,
      nome_do_produto: values.nome_do_produto.trim(),
      // empty inputs become NaN so they fail validation instead of silently becoming 0
      valor_anterior: values.valor_anterior === "" ? NaN : Number(values.valor_anterior),
      valor_atual: values.valor_atual === "" ? NaN : Number(values.valor_atual),
    });
    if (!parsed.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FormValues;
        fieldErrors[field] ??= issue.code === "invalid_type" ? "Informe um valor numérico." : issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    createDetalhamento.mutate(parsed.data, {
      onSuccess: (detalhamento) => {
        onCreated(detalhamento);
        close();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Adicionar detalhamento"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={createDetalhamento.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="detalhamento-auditoria-form" disabled={createDetalhamento.isPending}>
            {createDetalhamento.isPending ? "Salvando..." : "Salvar detalhamento"}
          </Button>
        </>
      }
    >
      <form id="detalhamento-auditoria-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Produto" htmlFor="nome_do_produto" error={errors.nome_do_produto}>
          <input
            id="nome_do_produto"
            className={inputClassName}
            value={values.nome_do_produto}
            onChange={set("nome_do_produto")}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor anterior (R$)" htmlFor="valor_anterior" error={errors.valor_anterior}>
            <input
              id="valor_anterior"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className={inputClassName}
              value={values.valor_anterior}
              onChange={set("valor_anterior")}
            />
          </Field>
          <Field label="Valor atual (R$)" htmlFor="valor_atual" error={errors.valor_atual}>
            <input
              id="valor_atual"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className={inputClassName}
              value={values.valor_atual}
              onChange={set("valor_atual")}
            />
          </Field>
        </div>
        <Field label="Observações adicionais" htmlFor="observacoes_adicionais" error={errors.observacoes_adicionais}>
          <textarea
            id="observacoes_adicionais"
            rows={3}
            maxLength={1000}
            className={`${inputClassName} h-auto py-2`}
            value={values.observacoes_adicionais}
            onChange={set("observacoes_adicionais")}
          />
        </Field>
        {createDetalhamento.isError && <p className="text-sm text-danger">Não foi possível salvar o detalhamento.</p>}
      </form>
    </Modal>
  );
}
