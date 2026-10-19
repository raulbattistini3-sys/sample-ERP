import { FormEvent, useState } from "react";
import { Link, Location, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { AuthLayout } from "../../../layouts/AuthLayout";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import { useLogin } from "../hooks/useUsuarios";
import { LoginUsuarioPayload, LoginUsuarioSchema } from "../types/usuario.types";

type FieldErrors = Partial<Record<keyof LoginUsuarioPayload, string>>;

export const LoginPage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const loginMutation = useLogin();

  const [form, setForm] = useState<LoginUsuarioPayload>({ email: "", senha: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // set by ProtectedRoute when it bounced the user here
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";

  if (isAuthenticated) return <Navigate to={from} replace />;

  const updateField = (field: keyof LoginUsuarioPayload) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const result = LoginUsuarioSchema.safeParse({ ...form, email: form.email.trim() });
    if (!result.success) {
      setFieldErrors(toFieldErrors<keyof LoginUsuarioPayload>(result.error.issues));
      return;
    }

    loginMutation.mutate(result.data, {
      onSuccess: () => navigate(from, { replace: true }),
    });
  };

  const submitError = loginMutation.isError
    ? getApiErrorMessage(loginMutation.error, "Não foi possível entrar. Tente novamente.")
    : null;

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse sua conta para continuar."
      footer={
        <>
          Não tem uma conta?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Cadastre-se
          </Link>
        </>
      }
    >
      {submitError && <ErrorAlert message={submitError} className="mt-4" />}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <Field id="email" label="E-mail" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="voce@empresa.com"
            value={form.email}
            onChange={(e) => updateField("email")(e.target.value)}
            invalid={!!fieldErrors.email}
          />
        </Field>

        <Field id="senha" label="Senha" error={fieldErrors.senha}>
          <Input
            id="senha"
            type="password"
            autoComplete="current-password"
            value={form.senha}
            onChange={(e) => updateField("senha")(e.target.value)}
            invalid={!!fieldErrors.senha}
          />
        </Field>

        <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
          {loginMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loginMutation.isPending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </AuthLayout>
  );
};
