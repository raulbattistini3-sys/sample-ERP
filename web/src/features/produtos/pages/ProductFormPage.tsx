import { FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PowerOff, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors, toNumber } from "../../../lib/form";
import { CategoriaNomesEnum } from "../../categoria/types/categoria.types";
import { useCategorias } from "../../categoria/hooks/useCategorias";
import {
  useCreateProduct,
  useDeactivateProduct,
  useDeleteProduct,
  useProduct,
  useUpdateProduct,
} from "../hooks/useProducts";
import { Product, ProductFormSchema, ProductFormValues } from "../types/produto.types";

// numeric inputs are kept as typed text and converted on submit
type FormValues = Record<keyof ProductFormValues, string>;
type FieldErrors = Partial<Record<keyof ProductFormValues, string>>;

export function ProductFormPage() {
  const { id = "" } = useParams();
  const { data: product, isLoading, error } = useProduct(id);

  if (!id) return <ProductForm />;
  if (isLoading) return <LoadingState />;
  if (error || !product) return <ErrorAlert message={getApiErrorMessage(error, "Produto não encontrado.")} />;
  return <ProductForm key={product.id} product={product} />;
}

function ProductForm({ product }: { product?: Product }) {
  const navigate = useNavigate();
  const isEdit = !!product;
  const { data: categorias } = useCategorias();

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deactivateMutation = useDeactivateProduct();
  const deleteMutation = useDeleteProduct();

  const [form, setForm] = useState<FormValues>({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    categoria: product?.categoria.nome ?? "",
    valor_de_custo: product ? String(product.valor_de_custo) : "",
    icms: product ? String(product.icms) : "",
    valor_de_venda: product ? String(product.valor_de_venda) : "",
    quantidade_em_estoque: product ? String(product.quantidade_em_estoque) : "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // only offer active categories; fall back to the full enum until the list loads
  const categoriaOptions = categorias?.filter((c) => c.ativo).map((c) => c.nome) ?? CategoriaNomesEnum.options;

  const updateField = (field: keyof FormValues) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const backToList = () => navigate("/products");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const result = ProductFormSchema.safeParse({
      ...form,
      valor_de_custo: toNumber(form.valor_de_custo),
      icms: toNumber(form.icms),
      valor_de_venda: toNumber(form.valor_de_venda),
      quantidade_em_estoque: toNumber(form.quantidade_em_estoque),
    });
    if (!result.success) {
      setFieldErrors(toFieldErrors<keyof ProductFormValues>(result.error.issues));
      return;
    }

    const { categoria, ...values } = result.data;
    if (product) {
      updateMutation.mutate(
        { ...product, ...values, categoria: { nome: categoria } },
        { onSuccess: backToList },
      );
    } else {
      createMutation.mutate({ ...values, categoria: { nome: categoria } }, { onSuccess: backToList });
    }
  };

  const handleDeactivate = () => {
    if (!product || !window.confirm(`Desativar o produto "${product.name}"?`)) return;
    deactivateMutation.mutate(product.id, { onSuccess: backToList });
  };

  const handleDelete = () => {
    if (!product || !window.confirm(`Excluir o produto "${product.name}"? Essa ação não pode ser desfeita.`)) return;
    deleteMutation.mutate(product.id, { onSuccess: backToList });
  };

  const mutationError = [createMutation, updateMutation, deactivateMutation, deleteMutation].find((m) => m.isError)?.error;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const custo = toNumber(form.valor_de_custo);
  const venda = toNumber(form.valor_de_venda);
  const margem = custo > 0 && !Number.isNaN(venda) ? ((venda - custo) / custo) * 100 : null;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Editar produto" : "Novo produto"}
        actions={
          isEdit && (
            <>
              {product.ativo && (
                <Button variant="secondary" onClick={handleDeactivate} disabled={deactivateMutation.isPending}>
                  <PowerOff className="h-4 w-4" aria-hidden="true" />
                  Desativar
                </Button>
              )}
              <Button variant="danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Excluir
              </Button>
            </>
          )
        }
      />

      <FormCard>
        {mutationError && (
          <ErrorAlert message={getApiErrorMessage(mutationError, "Não foi possível salvar o produto.")} className="mb-4" />
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Nome" error={fieldErrors.name}>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => updateField("name")(e.target.value)}
                invalid={!!fieldErrors.name}
              />
            </Field>

            <Field id="sku" label="SKU" error={fieldErrors.sku}>
              <Input
                id="sku"
                value={form.sku}
                onChange={(e) => updateField("sku")(e.target.value)}
                invalid={!!fieldErrors.sku}
              />
            </Field>

            <Field id="categoria" label="Categoria" error={fieldErrors.categoria && "Selecione uma categoria"}>
              <Select
                id="categoria"
                value={form.categoria}
                onChange={(e) => updateField("categoria")(e.target.value)}
                invalid={!!fieldErrors.categoria}
              >
                <option value="" disabled>
                  Selecione...
                </option>
                {categoriaOptions.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="quantidade_em_estoque" label="Quantidade em estoque" error={fieldErrors.quantidade_em_estoque}>
              <Input
                id="quantidade_em_estoque"
                inputMode="numeric"
                value={form.quantidade_em_estoque}
                onChange={(e) => updateField("quantidade_em_estoque")(e.target.value)}
                invalid={!!fieldErrors.quantidade_em_estoque}
              />
            </Field>

            <Field id="valor_de_custo" label="Valor de custo (R$)" error={fieldErrors.valor_de_custo}>
              <Input
                id="valor_de_custo"
                inputMode="decimal"
                placeholder="0,00"
                value={form.valor_de_custo}
                onChange={(e) => updateField("valor_de_custo")(e.target.value)}
                invalid={!!fieldErrors.valor_de_custo}
              />
            </Field>

            <Field
              id="valor_de_venda"
              label="Valor de venda (R$)"
              error={fieldErrors.valor_de_venda}
              hint={margem !== null ? `Margem sobre o custo: ${margem.toFixed(1)}%` : undefined}
            >
              <Input
                id="valor_de_venda"
                inputMode="decimal"
                placeholder="0,00"
                value={form.valor_de_venda}
                onChange={(e) => updateField("valor_de_venda")(e.target.value)}
                invalid={!!fieldErrors.valor_de_venda}
              />
            </Field>

            <Field id="icms" label="ICMS (%)" error={fieldErrors.icms}>
              <Input
                id="icms"
                inputMode="decimal"
                value={form.icms}
                onChange={(e) => updateField("icms")(e.target.value)}
                invalid={!!fieldErrors.icms}
              />
            </Field>
          </div>

          {isEdit && (
            <p className="text-xs text-muted">
              Cadastrado em {new Date(product.data_de_cadastro).toLocaleDateString("pt-BR")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={backToList}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </FormCard>
    </div>
  );
}
