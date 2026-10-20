import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert } from "../../../components/ui/PageState";
import { AuthLayout } from "../../../layouts/AuthLayout";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import { useResetPassword } from "../hooks/useUsuarios";
import { ResetPasswordFormSchema, ResetPasswordFormValues } from "../types/usuario.types";

type FieldErrors = Partial<Record<keyof ResetPasswordFormValues, string>>;

// opened from the emailed link: /reset-password?token=...
export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const resetMutation = useResetPassword();

  const [form, setForm] = useState<ResetPasswordFormValues>({ senha: "", confirmarSenha: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const updateField = (field: keyof ResetPasswordFormValues) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = ResetPasswordFormSchema.safeParse(form);
    const errors: FieldErrors = result.success ? {} : toFieldErrors<keyof ResetPasswordFormValues>(result.error.issues);
    if (form.confirmarSenha !== form.senha) errors.confirmarSenha = "As senhas não conferem";
    if (!result.success || errors.confirmarSenha) {
      setFieldErrors(errors);
      return;
    }
    resetMutation.mutate(
      { token, senha: form.senha },
      { onSuccess: () => navigate("/login", { replace: true, state: { passwordReset: true } }) },
    );
  };

  const footer = (
    <Link to="/forgot-password" className="font-medium text-accent hover:underline">
      Pedir um novo link
    </Link>
  );

  if (!token) {
    return (
      <AuthLayout title="Link inválido" subtitle="Este endereço não tem um link de redefinição." footer={footer}>
        <ErrorAlert className="mt-4" message="Abra o link exatamente como chegou no e-mail ou peça um novo." />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar nova senha" subtitle="Escolha uma senha com pelo menos 6 caracteres." footer={footer}>
      {resetMutation.isError && (
        <ErrorAlert
          className="mt-4"
          message={getApiErrorMessage(resetMutation.error, "Não foi possível redefinir a senha. Tente novamente.")}
        />
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <Field id="senha" label="Nova senha" error={fieldErrors.senha}>
          <Input
            id="senha"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={form.senha}
            onChange={(e) => updateField("senha")(e.target.value)}
            invalid={!!fieldErrors.senha}
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

        <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
          {resetMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {resetMutation.isPending ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </form>
    </AuthLayout>
  );
};
