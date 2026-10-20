import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { AuthLayout } from "../../../layouts/AuthLayout";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import { useLogin, useRegisterUsuario } from "../hooks/useUsuarios";
import { RegisterUsuarioPayload, RegisterUsuarioSchema } from "../types/usuario.types";

// permissoes/ativo aren't user-editable here; the schema defaults them on parse
type FormValues = Pick<RegisterUsuarioPayload, "nome" | "email" | "senha"> & { confirmarSenha: string };
type FieldErrors = Partial<Record<keyof FormValues, string>>;

export const RegisterPage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const registerMutation = useRegisterUsuario();
  const loginMutation = useLogin();

  const [form, setForm] = useState<FormValues>({ nome: "", email: "", senha: "", confirmarSenha: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  if (isAuthenticated) return <Navigate to="/" replace />;

  const updateField = (field: keyof FormValues) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const { confirmarSenha, ...payload } = form;
    const result = RegisterUsuarioSchema.safeParse({ ...payload, email: payload.email.trim() });
    const errors: FieldErrors = result.success ? {} : toFieldErrors<keyof FormValues>(result.error.issues);
    if (confirmarSenha !== form.senha) errors.confirmarSenha = "As senhas não conferem";
    if (!result.success || errors.confirmarSenha) {
      setFieldErrors(errors);
      return;
    }

    const { email, senha } = result.data;
    // sign the new user straight in instead of sending them back to /login
    registerMutation.mutate(result.data, {
      onSuccess: () => loginMutation.mutate({ email, senha }, { onSuccess: () => navigate("/", { replace: true }) }),
    });
  };

  const isPending = registerMutation.isPending || loginMutation.isPending;
  const submitError = registerMutation.isError
    ? getApiErrorMessage(registerMutation.error, "Não foi possível criar a conta. Tente novamente.")
    : loginMutation.isError
      ? "Conta criada, mas não foi possível entrar automaticamente. Faça login."
      : null;

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Preencha seus dados para começar."
      footer={
        <>
          Já tem uma conta?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      {submitError && <ErrorAlert message={submitError} className="mt-4" />}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <Field id="nome" label="Nome" error={fieldErrors.nome}>
          <Input
            id="nome"
            autoComplete="name"
            autoFocus
            value={form.nome}
            onChange={(e) => updateField("nome")(e.target.value)}
            invalid={!!fieldErrors.nome}
          />
        </Field>

        <Field id="email" label="E-mail" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com"
            value={form.email}
            onChange={(e) => updateField("email")(e.target.value)}
            invalid={!!fieldErrors.email}
          />
        </Field>

        <Field id="senha" label="Senha" error={fieldErrors.senha} hint="Mínimo de 6 caracteres.">
          <Input
            id="senha"
            type="password"
            autoComplete="new-password"
            value={form.senha}
            onChange={(e) => updateField("senha")(e.target.value)}
            invalid={!!fieldErrors.senha}
          />
        </Field>

        <Field id="confirmarSenha" label="Confirmar senha" error={fieldErrors.confirmarSenha}>
          <Input
            id="confirmarSenha"
            type="password"
            autoComplete="new-password"
            value={form.confirmarSenha}
            onChange={(e) => updateField("confirmarSenha")(e.target.value)}
            invalid={!!fieldErrors.confirmarSenha}
          />
        </Field>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isPending ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>
    </AuthLayout>
  );
};
