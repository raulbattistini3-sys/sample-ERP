import { FormEvent, ReactNode, useState } from "react";
import { ALL_ITEMS_AMOUNT } from "../../../lib/pagination";
import { useBackToList } from "../../../hooks/useListPage";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toDateTimeLocal, toFieldErrors, toNumber } from "../../../lib/form";
import { isAdminRole } from "../../../lib/permissoes";
import { useProducts } from "../../produtos/hooks/useProducts";
import { Product, ProductFormSchema, ProductFormValues } from "../../produtos/types/produto.types";
import { useCategoriaNomes, useCategorias } from "../../categoria/hooks/useCategorias";
import { Categoria, CategoriaNomesEnum, CategoriaTiposEnum } from "../../categoria/types/categoria.types";
import { useCreateAuditoria } from "../hooks/useAuditoria";
import {
  AcaoEfetuada,
  AcaoEfetuadaEnum,
  AlvoTipo,
  AuditoriaAlvo,
  AuditoriaFormSchema,
  AuditoriaFormValues,
  acaoEfetuadaLabels,
} from "../types/auditoria.types";

// product fields are kept as typed text and converted on submit, like the product form
type ProdutoFields = Record<keyof ProductFormValues, string> & { ativo: boolean };
type CategoriaFields = Pick<Categoria, "nome" | "tipo" | "ativo">;
type CommonFields = Omit<Record<keyof AuditoriaFormValues, string>, "acao_efetuada"> & { acao_efetuada: AcaoEfetuada };
type FieldErrors = Partial<Record<keyof AuditoriaFormValues | keyof ProductFormValues, string>>;

const toProdutoFields = (p: Product): ProdutoFields => ({
  name: p.name,
  sku: p.sku,
  categoria: p.categoria.nome,
  valor_de_custo: String(p.valor_de_custo),
  icms: String(p.icms),
  valor_de_venda: String(p.valor_de_venda),
  quantidade_em_estoque: String(p.quantidade_em_estoque),
  ativo: p.ativo,
});

const toCategoriaFields = ({ nome, tipo, ativo }: Categoria): CategoriaFields => ({ nome, tipo, ativo });

const NUMERIC_FIELDS = new Set<keyof ProductFormValues>(["valor_de_custo", "icms", "valor_de_venda", "quantidade_em_estoque"]);

// "12,50" and "12.5" are the same value; text fields ignore surrounding spaces, like the API's trim
const productFieldChanged = (field: keyof ProductFormValues, before: string, after: string) =>
  NUMERIC_FIELDS.has(field) ? toNumber(before) !== toNumber(after) : before.trim() !== after.trim();

const statusLabel = (ativo: boolean) => (ativo ? "Ativo" : "Inativo");

// the field's value before the auditoria, shown only once it was changed
const antes = (changed: boolean, value: string) => (changed ? `Antes: ${value}` : undefined);

export const AuditoriaFormPage = () => {
  const backToList = useBackToList("/auditoria");
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.permissoes);

  // ADM/SU also receive inactive products and can audit them (and change their status)
  const { data: productsPage, isLoading: loadingProducts } = useProducts(1, ALL_ITEMS_AMOUNT);
  const products = productsPage?.data;
  const { data: categoriasPage, isLoading: loadingCategorias } = useCategorias(1, ALL_ITEMS_AMOUNT);
  const categorias = categoriasPage?.data;
  const { data: categoriaNomesAtivas } = useCategoriaNomes();
  const createMutation = useCreateAuditoria();

  const [tipo, setTipo] = useState<AlvoTipo>("produto");
  const [common, setCommon] = useState<CommonFields>({
    acao_efetuada: "Alteracao",
    data_de_audicao: toDateTimeLocal(new Date()),
    alvo_id: "",
    observacoes_adicionais: "",
  });
  const [produto, setProduto] = useState<ProdutoFields | null>(null);
  const [categoria, setCategoria] = useState<CategoriaFields | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const originalProduct = tipo === "produto" ? products?.find((p) => p.id === common.alvo_id) : undefined;
  const originalCategoria = tipo === "categoria" ? categorias?.find((c) => c.id === common.alvo_id) : undefined;
  const before = originalProduct ? toProdutoFields(originalProduct) : null;

  const clearError = (field: keyof FieldErrors) => {
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setFormError(null);
  };

  const updateCommon = (field: keyof CommonFields) => (value: string) => {
    setCommon((prev) => ({ ...prev, [field]: value }));
    clearError(field);
  };

  const updateProduto = (field: keyof ProductFormValues) => (value: string) => {
    setProduto((prev) => prev && { ...prev, [field]: value });
    clearError(field);
  };

  const handleTipoChange = (value: AlvoTipo) => {
    setTipo(value);
    setCommon((prev) => ({ ...prev, alvo_id: "" }));
    setProduto(null);
    setCategoria(null);
    setFieldErrors({});
    setFormError(null);
  };

  // picking what to audit fills every field with its current value
  const handleAlvoChange = (id: string) => {
    setCommon((prev) => ({ ...prev, alvo_id: id }));
    if (tipo === "produto") {
      const p = products?.find((item) => item.id === id);
      setProduto(p ? toProdutoFields(p) : null);
    } else {
      const c = categorias?.find((item) => item.id === id);
      setCategoria(c ? toCategoriaFields(c) : null);
    }
    setFieldErrors({});
    setFormError(null);
  };

  const produtoChanges =
    produto && before
      ? (Object.keys(before) as (keyof ProdutoFields)[]).filter((field) =>
          field === "ativo"
            ? produto.ativo !== before.ativo
            : productFieldChanged(field, before[field], produto[field]),
        )
      : [];
  const categoriaChanges =
    categoria && originalCategoria
      ? (["nome", "tipo", "ativo"] as const).filter((field) => categoria[field] !== originalCategoria[field])
      : [];
  const changedCount = tipo === "produto" ? produtoChanges.length : categoriaChanges.length;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const commonResult = AuditoriaFormSchema.safeParse(common);
    const produtoResult =
      tipo === "produto" && produto
        ? ProductFormSchema.safeParse({
            ...produto,
            valor_de_custo: toNumber(produto.valor_de_custo),
            icms: toNumber(produto.icms),
            valor_de_venda: toNumber(produto.valor_de_venda),
            quantidade_em_estoque: toNumber(produto.quantidade_em_estoque),
          })
        : null;

    const errors: FieldErrors = {
      ...(commonResult.success ? {} : toFieldErrors<keyof AuditoriaFormValues>(commonResult.error.issues)),
      ...(produtoResult && !produtoResult.success
        ? toFieldErrors<keyof ProductFormValues>(produtoResult.error.issues)
        : {}),
    };
    setFieldErrors(errors);
    if (!commonResult.success || (produtoResult && !produtoResult.success)) return;

    if (changedCount === 0) {
      setFormError("Altere ao menos um campo para registrar a auditoria.");
      return;
    }

    let alvo: AuditoriaAlvo;
    if (tipo === "produto" && produtoResult?.success && produto) {
      const { categoria: categoriaNome, ...valores } = produtoResult.data;
      alvo = {
        tipo: "produto",
        id: common.alvo_id,
        valores: { ...valores, categoria: { nome: categoriaNome }, ativo: produto.ativo },
      };
    } else if (tipo === "categoria" && categoria) {
      alvo = { tipo: "categoria", id: common.alvo_id, valores: categoria };
    } else {
      return;
    }

    const values = commonResult.data;
    createMutation.mutate(
      {
        acao_efetuada: values.acao_efetuada,
        data_de_audicao: new Date(values.data_de_audicao).toISOString(),
        observacoes_adicionais: values.observacoes_adicionais,
        alvo,
      },
      { onSuccess: backToList },
    );
  };

  // the product can stay in an inactive categoria, but only be moved to an active one
  const categoriaOptions = [
    ...new Set([...(before ? [before.categoria] : []), ...(categoriaNomesAtivas ?? [])]),
  ];
  const loadingAlvos = tipo === "produto" ? loadingProducts : loadingCategorias;

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

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="acao_efetuada" label="Ação efetuada">
              <Select
                id="acao_efetuada"
                value={common.acao_efetuada}
                onChange={(e) => updateCommon("acao_efetuada")(e.target.value)}
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
                value={common.data_de_audicao}
                onChange={(e) => updateCommon("data_de_audicao")(e.target.value)}
                invalid={!!fieldErrors.data_de_audicao}
              />
            </Field>

            <Field id="alvo_tipo" label="Auditar">
              <Select id="alvo_tipo" value={tipo} onChange={(e) => handleTipoChange(e.target.value as AlvoTipo)}>
                <option value="produto">Produto</option>
                <option value="categoria">Categoria</option>
              </Select>
            </Field>

            <Field id="alvo_id" label={tipo === "produto" ? "Produto" : "Categoria"} error={fieldErrors.alvo_id}>
              <Select
                id="alvo_id"
                value={common.alvo_id}
                onChange={(e) => handleAlvoChange(e.target.value)}
                disabled={loadingAlvos}
                invalid={!!fieldErrors.alvo_id}
              >
                <option value="" disabled>
                  {loadingAlvos ? "Carregando..." : "Selecione..."}
                </option>
                {tipo === "produto"
                  ? products?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                        {p.ativo ? "" : " (inativo)"}
                      </option>
                    ))
                  : categorias?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                        {c.ativo ? "" : " (inativa)"}
                      </option>
                    ))}
              </Select>
            </Field>
          </div>

          {produto && before && (
            <FieldsSection count={produtoChanges.length}>
              <div className="sm:col-span-2">
                <TextField
                  id="name"
                  label="Nome"
                  value={produto.name}
                  onChange={updateProduto("name")}
                  error={fieldErrors.name}
                  hint={antes(produtoChanges.includes("name"), before.name)}
                />
              </div>
              <TextField
                id="sku"
                label="SKU"
                value={produto.sku}
                onChange={updateProduto("sku")}
                error={fieldErrors.sku}
                hint={antes(produtoChanges.includes("sku"), before.sku)}
              />
              <Field
                id="categoria"
                label="Categoria"
                error={fieldErrors.categoria}
                hint={antes(produtoChanges.includes("categoria"), before.categoria)}
              >
                <Select
                  id="categoria"
                  value={produto.categoria}
                  onChange={(e) => updateProduto("categoria")(e.target.value)}
                  invalid={!!fieldErrors.categoria}
                >
                  {categoriaOptions.map((nome) => (
                    <option key={nome} value={nome}>
                      {nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <TextField
                id="valor_de_custo"
                label="Valor de custo (R$)"
                inputMode="decimal"
                value={produto.valor_de_custo}
                onChange={updateProduto("valor_de_custo")}
                error={fieldErrors.valor_de_custo}
                hint={antes(produtoChanges.includes("valor_de_custo"), before.valor_de_custo)}
              />
              <TextField
                id="valor_de_venda"
                label="Valor de venda (R$)"
                inputMode="decimal"
                value={produto.valor_de_venda}
                onChange={updateProduto("valor_de_venda")}
                error={fieldErrors.valor_de_venda}
                hint={antes(produtoChanges.includes("valor_de_venda"), before.valor_de_venda)}
              />
              <TextField
                id="icms"
                label="ICMS (%)"
                inputMode="decimal"
                value={produto.icms}
                onChange={updateProduto("icms")}
                error={fieldErrors.icms}
                hint={antes(produtoChanges.includes("icms"), before.icms)}
              />
              <TextField
                id="quantidade_em_estoque"
                label="Quantidade em estoque"
                inputMode="numeric"
                value={produto.quantidade_em_estoque}
                onChange={updateProduto("quantidade_em_estoque")}
                error={fieldErrors.quantidade_em_estoque}
                hint={antes(produtoChanges.includes("quantidade_em_estoque"), before.quantidade_em_estoque)}
              />
              {/* only ADM/SU change a product's status; the API ignores it for everyone else */}
              {isAdmin && (
                <StatusField
                  id="produto_ativo"
                  value={produto.ativo}
                  onChange={(ativo) => setProduto((prev) => prev && { ...prev, ativo })}
                  hint={antes(produtoChanges.includes("ativo"), statusLabel(before.ativo))}
                />
              )}
            </FieldsSection>
          )}

          {categoria && originalCategoria && (
            <FieldsSection count={categoriaChanges.length}>
              <Field
                id="categoria_nome"
                label="Nome"
                hint={antes(categoriaChanges.includes("nome"), originalCategoria.nome)}
              >
                <Select
                  id="categoria_nome"
                  value={categoria.nome}
                  onChange={(e) =>
                    setCategoria((prev) => prev && { ...prev, nome: e.target.value as CategoriaFields["nome"] })
                  }
                >
                  {CategoriaNomesEnum.options.map((nome) => (
                    <option key={nome} value={nome}>
                      {nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="categoria_tipo"
                label="Tipo"
                hint={antes(categoriaChanges.includes("tipo"), originalCategoria.tipo)}
              >
                <Select
                  id="categoria_tipo"
                  value={categoria.tipo}
                  onChange={(e) =>
                    setCategoria((prev) => prev && { ...prev, tipo: e.target.value as CategoriaFields["tipo"] })
                  }
                >
                  {CategoriaTiposEnum.options.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <StatusField
                id="categoria_ativo"
                value={categoria.ativo}
                onChange={(ativo) => setCategoria((prev) => prev && { ...prev, ativo })}
                hint={antes(categoriaChanges.includes("ativo"), statusLabel(originalCategoria.ativo))}
              />
            </FieldsSection>
          )}

          <Field id="observacoes_adicionais" label="Observações" error={fieldErrors.observacoes_adicionais}>
            <Textarea
              id="observacoes_adicionais"
              maxLength={1000}
              value={common.observacoes_adicionais}
              onChange={(e) => updateCommon("observacoes_adicionais")(e.target.value)}
              invalid={!!fieldErrors.observacoes_adicionais}
            />
          </Field>

          {formError && <ErrorAlert message={formError} />}

          <p className="text-xs text-muted">
            Registrada como {user?.nome}. As alterações são aplicadas {tipo === "produto" ? "ao produto" : "à categoria"}{" "}
            junto com a auditoria.
          </p>

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

function FieldsSection({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-4" aria-labelledby="campos-auditados">
      <div className="flex items-center justify-between gap-2">
        <h3 id="campos-auditados" className="text-sm font-semibold text-ink">
          Campos
        </h3>
        <span className="text-xs text-muted" aria-live="polite">
          {count === 0 ? "Nenhuma alteração" : count === 1 ? "1 campo alterado" : `${count} campos alterados`}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  inputMode?: "decimal" | "numeric";
};

function TextField({ id, label, value, onChange, error, hint, inputMode }: TextFieldProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Input id={id} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} invalid={!!error} />
    </Field>
  );
}

function StatusField({
  id,
  value,
  onChange,
  hint,
}: {
  id: string;
  value: boolean;
  onChange: (ativo: boolean) => void;
  hint?: string;
}) {
  return (
    <Field id={id} label="Status" hint={hint}>
      <Select id={id} value={value ? "ativo" : "inativo"} onChange={(e) => onChange(e.target.value === "ativo")}>
        <option value="ativo">Ativo</option>
        <option value="inativo">Inativo</option>
      </Select>
    </Field>
  );
}
