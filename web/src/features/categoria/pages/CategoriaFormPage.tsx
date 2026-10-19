import { FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Select } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import {
  useArchiveCategoria,
  useCategoria,
  useCreateCategoria,
  useDeleteCategoria,
  useUpdateCategoria,
} from "../hooks/useCategorias";
import { Categoria, CategoriaNomesEnum, CategoriaTiposEnum } from "../types/categoria.types";

type FormValues = { nome: Categoria["nome"] | ""; tipo: Categoria["tipo"]; ativo: boolean };

export const CategoriaFormPage = () => {
  const { id = "" } = useParams();
  const { data: categoria, isLoading, error } = useCategoria(id);

  if (!id) return <CategoriaForm />;
  if (isLoading) return <LoadingState />;
  if (error || !categoria) return <ErrorAlert message={getApiErrorMessage(error, "Categoria não encontrada.")} />;
  return <CategoriaForm key={categoria.id} categoria={categoria} />;
};

function CategoriaForm({ categoria }: { categoria?: Categoria }) {
  const navigate = useNavigate();
  const isEdit = !!categoria;

  const createMutation = useCreateCategoria();
  const updateMutation = useUpdateCategoria();
  const archiveMutation = useArchiveCategoria();
  const deleteMutation = useDeleteCategoria();

  const [form, setForm] = useState<FormValues>({
    nome: categoria?.nome ?? "",
    tipo: categoria?.tipo ?? "Normal",
    ativo: categoria?.ativo ?? true,
  });
  const [nomeError, setNomeError] = useState<string>();

  const backToList = () => navigate("/categorias");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const nome = CategoriaNomesEnum.safeParse(form.nome);
    if (!nome.success) {
      setNomeError("Selecione o nome da categoria");
      return;
    }

    if (categoria) {
      updateMutation.mutate({ id: categoria.id, nome: nome.data, tipo: form.tipo, ativo: form.ativo }, { onSuccess: backToList });
    } else {
      createMutation.mutate({ nome: nome.data, tipo: form.tipo }, { onSuccess: backToList });
    }
  };

  const handleArchive = () => {
    if (!categoria || !window.confirm(`Arquivar a categoria "${categoria.nome}"?`)) return;
    archiveMutation.mutate(categoria.id, { onSuccess: backToList });
  };

  const handleDelete = () => {
    if (!categoria || !window.confirm(`Excluir a categoria "${categoria.nome}"? Essa ação não pode ser desfeita.`)) return;
    deleteMutation.mutate(categoria.id, { onSuccess: backToList });
  };

  const mutationError = [createMutation, updateMutation, archiveMutation, deleteMutation].find((m) => m.isError)?.error;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Editar categoria" : "Nova categoria"}
        actions={
          isEdit && (
            <>
              {categoria.ativo && (
                <Button variant="secondary" onClick={handleArchive} disabled={archiveMutation.isPending}>
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  Arquivar
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
          <ErrorAlert message={getApiErrorMessage(mutationError, "Não foi possível salvar a categoria.")} className="mb-4" />
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="nome" label="Nome" error={nomeError}>
              <Select
                id="nome"
                value={form.nome}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, nome: e.target.value as FormValues["nome"] }));
                  setNomeError(undefined);
                }}
                invalid={!!nomeError}
              >
                <option value="" disabled>
                  Selecione...
                </option>
                {CategoriaNomesEnum.options.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="tipo" label="Tipo">
              <Select
                id="tipo"
                value={form.tipo}
                onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value as FormValues["tipo"] }))}
              >
                {CategoriaTiposEnum.options.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((prev) => ({ ...prev, ativo: e.target.checked }))}
                className="h-4 w-4 accent-accent"
              />
              Categoria ativa
            </label>
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
