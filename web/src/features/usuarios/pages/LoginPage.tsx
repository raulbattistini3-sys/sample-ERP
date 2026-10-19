import { FormEvent, useState } from "react";
import { Link, Location, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { useLogin } from "../hooks/useUsuarios";
import { LoginUsuarioPayload, LoginUsuarioSchema } from "../types/usuario.types";

type FieldErrors = Partial<Record<keyof LoginUsuarioPayload, string>>;

const inputStyles =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted " +
  "focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent";

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
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof LoginUsuarioPayload;
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
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
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="h-7 w-7 rounded-sm bg-accent" aria-hidden="true" />
          <span className="text-lg font-semibold text-ink">ERP Estoque</span>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Entrar</h1>
          <p className="mt-1 text-sm text-muted">Acesse sua conta para continuar.</p>

          {submitError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-ink">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="voce@empresa.com"
                value={form.email}
                onChange={(e) => updateField("email")(e.target.value)}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "email-error" : undefined}
                className={cn(inputStyles, fieldErrors.email && "border-red-400 focus:border-red-500 focus:ring-red-200")}
              />
              {fieldErrors.email && (
                <p id="email-error" className="text-xs text-red-600">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="senha" className="block text-sm font-medium text-ink">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={form.senha}
                onChange={(e) => updateField("senha")(e.target.value)}
                aria-invalid={!!fieldErrors.senha}
                aria-describedby={fieldErrors.senha ? "senha-error" : undefined}
                className={cn(inputStyles, fieldErrors.senha && "border-red-400 focus:border-red-500 focus:ring-red-200")}
              />
              {fieldErrors.senha && (
                <p id="senha-error" className="text-xs text-red-600">
                  {fieldErrors.senha}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {loginMutation.isPending ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-muted">
          Não tem uma conta?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </main>
  );
};
