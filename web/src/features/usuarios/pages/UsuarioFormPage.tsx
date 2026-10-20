import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { useBackToList } from "../../../hooks/useListPage";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import {
  useArchiveUsuario,
  useDeleteUsuario,
  useRegisterUsuario,
  useUpdateUsuario,
  useUsuario,
} from "../hooks/useUsuarios";
import {
  PermissoesEnum,
  RegisterUsuarioSchema,
  UpdateUsuarioSchema,
  Usuario,
} from "../types/usuario.types";

type FormValues = {
  nome: string;
  email: string;
  permissoes: Usuario["permissoes"];
  ativo: boolean;
  senha: string;
};
type FieldErrors = Partial<Record<keyof FormValues, string>>;

export const UsuarioFormPage = () => {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: usuario, isLoading, error } = useUsuario(id);

  if (user?.permissoes !== "ADM") {
    return <ErrorAlert message="Apenas administradores podem gerenciar usuários." />;
  }
  if (!id) return <UsuarioForm />;
  if (isLoading) return <LoadingState />;
  if (error || !usuario) {
    return <ErrorAlert message={getApiErrorMessage(error, "Usuário não encontrado.")} />;
  }
  // keyed so the form state resets if the route switches to another user
  return <UsuarioForm key={usuario.id} usuario={usuario} />;
};

function UsuarioForm({ usuario }: { usuario?: Usuario }) {
  const { user } = useAuth();
  const isEdit = !!usuario;

  const registerMutation = useRegisterUsuario();
  const updateMutation = useUpdateUsuario();
  const archiveMutation = useArchiveUsuario();
  const deleteMutation = useDeleteUsuario();

  const [form, setForm] = useState<FormValues>({
    nome: usuario?.nome ?? "",
    email: usuario?.email ?? "",
    permissoes: usuario?.permissoes ?? "Estoque",
    ativo: usuario?.ativo ?? true,
    senha: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const updateField = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const backToList = useBackToList("/usuarios");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const email = form.email.trim();

    if (!usuario) {
      const result = RegisterUsuarioSchema.safeParse({
        nome: form.nome,
        email,
        senha: form.senha,
        permissoes: form.permissoes,
        ativo: true,
      });
      if (!result.success) return setFieldErrors(toFieldErrors<keyof FormValues>(result.error.issues));
      registerMutation.mutate(result.data, { onSuccess: backToList });
      return;
    }

    const result = UpdateUsuarioSchema.safeParse({
      id: usuario.id,
      nome: form.nome,
      email,
      permissoes: form.permissoes,
      ativo: form.ativo,
      senha: form.senha || undefined,
    });
    if (!result.success) return setFieldErrors(toFieldErrors<keyof FormValues>(result.error.issues));
    updateMutation.mutate(result.data, { onSuccess: backToList });
  };

  const handleArchive = () => {
    if (!usuario || !window.confirm(`Arquivar o usuário "${usuario.nome}"?`)) return;
    archiveMutation.mutate(usuario.id, { onSuccess: backToList });
  };

  const handleDelete = () => {
    if (!usuario || !window.confirm(`Excluir o usuário "${usuario.nome}"? Essa ação não pode ser desfeita.`)) return;
    deleteMutation.mutate(usuario.id, { onSuccess: backToList });
  };

  const mutationError = [registerMutation, updateMutation, archiveMutation, deleteMutation].find((m) => m.isError)?.error;
  const isSaving = registerMutation.isPending || updateMutation.isPending;
  const isSelf = usuario?.id === user?.id;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Editar usuário" : "Novo usuário"}
        actions={
          isEdit &&
          !isSelf && (
            <>
              <Button variant="secondary" onClick={handleArchive} disabled={archiveMutation.isPending}>
                <Archive className="h-4 w-4" aria-hidden="true" />
                Arquivar
              </Button>
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
          <ErrorAlert message={getApiErrorMessage(mutationError, "Não foi possível salvar o usuário.")} className="mb-4" />
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="nome" label="Nome" error={fieldErrors.nome}>
              <Input
                id="nome"
                value={form.nome}
                onChange={(e) => updateField("nome", e.target.value)}
                invalid={!!fieldErrors.nome}
              />
            </Field>

            <Field id="email" label="E-mail" error={fieldErrors.email}>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                invalid={!!fieldErrors.email}
              />
            </Field>

            <Field id="permissoes" label="Permissão" error={fieldErrors.permissoes}>
              <Select
                id="permissoes"
                value={form.permissoes}
                onChange={(e) => updateField("permissoes", e.target.value as FormValues["permissoes"])}
                disabled={isSelf}
              >
                {PermissoesEnum.options.map((p) => (
                  <option key={p} value={p}>
                    {p === "ADM" ? "Administrador" : "Estoque"}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              id="senha"
              label={isEdit ? "Nova senha" : "Senha"}
              error={fieldErrors.senha}
              hint={isEdit ? "Deixe em branco para manter a senha atual." : "Mínimo de 6 caracteres."}
            >
              <Input
                id="senha"
                type="password"
                autoComplete="new-password"
                value={form.senha}
                onChange={(e) => updateField("senha", e.target.value)}
                invalid={!!fieldErrors.senha}
              />
            </Field>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => updateField("ativo", e.target.checked)}
                disabled={isSelf}
                className="h-4 w-4 accent-accent"
              />
              Usuário ativo
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
