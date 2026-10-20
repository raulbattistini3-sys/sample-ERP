import { FormEvent, useState } from "react";
import { ALL_ITEMS_AMOUNT } from "../../../lib/pagination";
import { useBackToList } from "../../../hooks/useListPage";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toDateTimeLocal, toFieldErrors, toNumber } from "../../../lib/form";
import { useProducts } from "../../produtos/hooks/useProducts";
import { useCreateAuditoria } from "../hooks/useAuditoria";
import {
  AcaoEfetuada,
  AcaoEfetuadaEnum,
  AuditoriaFormSchema,
  AuditoriaFormValues,
  acaoEfetuadaLabels,
} from "../types/auditoria.types";

type FormValues = Omit<Record<keyof AuditoriaFormValues, string>, "acao_efetuada"> & { acao_efetuada: AcaoEfetuada };
type FieldErrors = Partial<Record<keyof AuditoriaFormValues, string>>;

export const AuditoriaFormPage = () => {
  const backToList = useBackToList("/auditoria");
  const { user } = useAuth();
  const { data: productsPage, isLoading: loadingProducts } = useProducts(1, ALL_ITEMS_AMOUNT);
  const products = productsPage?.data;
  const createMutation = useCreateAuditoria();

  const [form, setForm] = useState<FormValues>({
    acao_efetuada: "Alteracao",
    data_de_audicao: toDateTimeLocal(new Date()),
    produto_id: "",
    valor_anterior: "",
    valor_atual: "",
    observacoes_adicionais: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const updateField = (field: keyof FormValues) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // picking a product pre-fills "valor anterior" with its current sale price
  const handleProductChange = (produtoId: string) => {
    const product = products?.find((p) => p.id === produtoId);
    setForm((prev) => ({
      ...prev,
      produto_id: produtoId,
      valor_anterior: product ? String(product.valor_de_venda) : prev.valor_anterior,
    }));
    setFieldErrors((prev) => ({ ...prev, produto_id: undefined, valor_anterior: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const result = AuditoriaFormSchema.safeParse({
      ...form,
      valor_anterior: toNumber(form.valor_anterior),
      valor_atual: toNumber(form.valor_atual),
    });
    if (!result.success) {
      setFieldErrors(toFieldErrors<keyof AuditoriaFormValues>(result.error.issues));
      return;
    }

    const values = result.data;
    const product = products?.find((p) => p.id === values.produto_id);
    if (!user || !product) return;

    createMutation.mutate(
      {
        acao_efetuada: values.acao_efetuada,
        data_de_audicao: new Date(values.data_de_audicao).toISOString(),
        usuario_id: user.id,
        itens: [product.id],
        detalhamento_auditoria: {
          nome_do_produto: product.name,
          valor_anterior: values.valor_anterior.toFixed(2),
          valor_atual: values.valor_atual.toFixed(2),
          observacoes_adicionais: values.observacoes_adicionais,
        },
      },
      { onSuccess: backToList },
    );
  };

  return (
    <div>
      <PageHeader title="Nova auditoria" />

      <FormCard>
        {createMutation.isError && (
          <ErrorAlert
            message={getApiErrorMessage(createMutation.error, "Não foi possível registrar a auditoria.")}
            className="mb-4"
          />
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="acao_efetuada" label="Ação efetuada">
              <Select
                id="acao_efetuada"
                value={form.acao_efetuada}
                onChange={(e) => updateField("acao_efetuada")(e.target.value)}
              >
                {AcaoEfetuadaEnum.options.map((acao) => (
                  <option key={acao} value={acao}>
                    {acaoEfetuadaLabels[acao]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="data_de_audicao" label="Data da auditoria" error={fieldErrors.data_de_audicao}>
              <Input
                id="data_de_audicao"
                type="datetime-local"
                value={form.data_de_audicao}
                onChange={(e) => updateField("data_de_audicao")(e.target.value)}
                invalid={!!fieldErrors.data_de_audicao}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field id="produto_id" label="Produto" error={fieldErrors.produto_id}>
                <Select
                  id="produto_id"
                  value={form.produto_id}
                  onChange={(e) => handleProductChange(e.target.value)}
                  disabled={loadingProducts}
                  invalid={!!fieldErrors.produto_id}
                >
                  <option value="" disabled>
                    {loadingProducts ? "Carregando produtos..." : "Selecione..."}
                  </option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field id="valor_anterior" label="Valor anterior (R$)" error={fieldErrors.valor_anterior}>
              <Input
                id="valor_anterior"
                inputMode="decimal"
                value={form.valor_anterior}
                onChange={(e) => updateField("valor_anterior")(e.target.value)}
                invalid={!!fieldErrors.valor_anterior}
              />
            </Field>

            <Field id="valor_atual" label="Valor atual (R$)" error={fieldErrors.valor_atual}>
              <Input
                id="valor_atual"
                inputMode="decimal"
                value={form.valor_atual}
                onChange={(e) => updateField("valor_atual")(e.target.value)}
                invalid={!!fieldErrors.valor_atual}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field id="observacoes_adicionais" label="Observações" error={fieldErrors.observacoes_adicionais}>
                <Textarea
                  id="observacoes_adicionais"
                  maxLength={1000}
                  value={form.observacoes_adicionais}
                  onChange={(e) => updateField("observacoes_adicionais")(e.target.value)}
                  invalid={!!fieldErrors.observacoes_adicionais}
                />
              </Field>
            </div>
          </div>

          <p className="text-xs text-muted">Registrada como {user?.nome}.</p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={backToList}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Registrando..." : "Registrar auditoria"}
            </Button>
          </div>
        </form>
      </FormCard>
    </div>
  );
};
