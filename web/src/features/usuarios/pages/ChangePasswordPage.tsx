import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { AuthLayout } from "../../../layouts/AuthLayout";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import { useChangePassword } from "../hooks/useUsuarios";
import { ChangePasswordFormSchema, ChangePasswordFormValues } from "../types/usuario.types";

type FieldErrors = Partial<Record<keyof ChangePasswordFormValues, string>>;

// /trocar-senha: any signed-in usuario can change its senha here; one created with a known senha (the
// first superuser) is sent here by ProtectedRoute and can't leave until it does
export const ChangePasswordPage = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const changeMutation = useChangePassword();
  const forced = !!user?.trocaSenhaObrigatoria;

  const [form, setForm] = useState<ChangePasswordFormValues>({ senhaAtual: "", novaSenha: "", confirmarSenha: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const updateField = (field: keyof ChangePasswordFormValues) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = ChangePasswordFormSchema.safeParse(form);
    const errors: FieldErrors = result.success
      ? {}
      : toFieldErrors<keyof ChangePasswordFormValues>(result.error.issues);
    if (form.confirmarSenha !== form.novaSenha) errors.confirmarSenha = "As senhas não conferem";
    if (!errors.novaSenha && form.novaSenha && form.novaSenha === form.senhaAtual) {
      errors.novaSenha = "A nova senha deve ser diferente da atual";
    }
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    changeMutation.mutate(
      { senhaAtual: form.senhaAtual, novaSenha: form.novaSenha },
      { onSuccess: () => navigate("/", { replace: true }) },
    );
  };

  const footer = forced ? (
    <button type="button" onClick={logout} className="font-medium text-accent hover:underline">
      Sair
    </button>
  ) : (
    <Link to="/" className="font-medium text-accent hover:underline">
      Voltar
    </Link>
  );

  return (
    <AuthLayout
      title={forced ? "Defina sua senha" : "Trocar senha"}
      subtitle={
        forced
          ? "Esta conta foi criada com uma senha provisória. Escolha a sua (pelo menos 6 caracteres) para continuar."
          : "Escolha uma senha com pelo menos 6 caracteres. Suas outras sessões serão encerradas."
      }
      footer={footer}
    >
      {changeMutation.isError && (
        <ErrorAlert
          className="mt-4"
          message={getApiErrorMessage(changeMutation.error, "Não foi possível trocar a senha. Tente novamente.")}
        />
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <Field id="senhaAtual" label={forced ? "Senha provisória" : "Senha atual"} error={fieldErrors.senhaAtual}>
          <Input
            id="senhaAtual"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={form.senhaAtual}
            onChange={(e) => updateField("senhaAtual")(e.target.value)}
            invalid={!!fieldErrors.senhaAtual}
          />
        </Field>

        <Field id="novaSenha" label="Nova senha" error={fieldErrors.novaSenha}>
          <Input
            id="novaSenha"
            type="password"
            autoComplete="new-password"
            value={form.novaSenha}
            onChange={(e) => updateField("novaSenha")(e.target.value)}
            invalid={!!fieldErrors.novaSenha}
          />
        </Field>

        <Field id="confirmarSenha" label="Confirmar nova senha" error={fieldErrors.confirmarSenha}>
          <Input
            id="confirmarSenha"
            type="password"
            autoComplete="new-password"
            value={form.confirmarSenha}
            onChange={(e) => updateField("confirmarSenha")(e.target.value)}
            invalid={!!fieldErrors.confirmarSenha}
          />
        </Field>

        <Button type="submit" className="w-full" disabled={changeMutation.isPending}>
          {changeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {changeMutation.isPending ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </form>
    </AuthLayout>
  );
};
