import { FormEvent, useState } from "react";
import axios from "axios";
import { Link, Location, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Info, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert, SuccessAlert } from "../../../components/ui/PageState";
import { useIsAuthenticated } from "../../../hooks/useSession";
import { AuthLayout } from "../../../layouts/AuthLayout";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import { useCheckLoginEmail, useLogin } from "../hooks/useUsuarios";
import { LoginEmailSchema, LoginUsuarioPayload, LoginUsuarioSchema } from "../types/usuario.types";

type FieldErrors = Partial<Record<keyof LoginUsuarioPayload, string>>;

// the email first, then the senha for an email the API knows
type Step = "email" | "senha";

const SEM_CONTA = "Ainda não encontramos uma conta com este e-mail. Confira se ele está certo ou crie uma conta.";

// the API answers 404 for an email with no account: not a failure, so it gets a hint instead of an error
const isEmailSemConta = (error: unknown) => axios.isAxiosError(error) && error.response?.status === 404;

export const LoginPage = () => {
  const isAuthenticated = useIsAuthenticated();
  const navigate = useNavigate();
  const location = useLocation();
  // set by the api client when the API ended the session
  const [searchParams] = useSearchParams();
  const sessionEnded = searchParams.get("sessao") === "encerrada";
  const checkEmailMutation = useCheckLoginEmail();
  const loginMutation = useLogin();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // the API's message when the email has no account yet
  const [semConta, setSemConta] = useState<string | null>(null);

  // set by ProtectedRoute when it bounced the user here, or by ResetPasswordPage after a reset
  const state = location.state as { from?: Location; passwordReset?: boolean } | null;
  const from = state?.from?.pathname ?? "/";

  if (isAuthenticated) return <Navigate to={from} replace />;

  const showSemConta = (error: unknown) => setSemConta(getApiErrorMessage(error, SEM_CONTA));

  const handleEmailSubmit = (event: FormEvent) => {
    event.preventDefault();

    const result = LoginEmailSchema.safeParse({ email: email.trim() });
    if (!result.success) {
      setFieldErrors(toFieldErrors<keyof LoginUsuarioPayload>(result.error.issues));
      return;
    }

    setSemConta(null);
    checkEmailMutation.mutate(result.data.email, {
      onSuccess: () => {
        setEmail(result.data.email);
        setStep("senha");
      },
      onError: (error) => {
        if (isEmailSemConta(error)) showSemConta(error);
      },
    });
  };

  const handleSenhaSubmit = (event: FormEvent) => {
    event.preventDefault();

    const result = LoginUsuarioSchema.safeParse({ email, senha });
    if (!result.success) {
      setFieldErrors(toFieldErrors<keyof LoginUsuarioPayload>(result.error.issues));
      return;
    }

    loginMutation.mutate(result.data, {
      onSuccess: () => navigate(from, { replace: true }),
      onError: (error) => {
        // the account went away between the two steps
        if (isEmailSemConta(error)) {
          backToEmail();
          showSemConta(error);
        }
      },
    });
  };

  const backToEmail = () => {
    setStep("email");
    setSenha("");
    setFieldErrors({});
    checkEmailMutation.reset();
    loginMutation.reset();
  };

  const activeMutation = step === "email" ? checkEmailMutation : loginMutation;
  const submitError =
    activeMutation.isError && !isEmailSemConta(activeMutation.error)
      ? getApiErrorMessage(activeMutation.error, "Não foi possível entrar. Tente novamente.")
      : null;

  return (
    <AuthLayout
      title="Entrar"
      subtitle={step === "email" ? "Informe seu e-mail para continuar." : "Agora, digite sua senha."}
      footer={
        <>
          Não tem uma conta?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Cadastre-se
          </Link>
        </>
      }
    >
      {sessionEnded && !state?.passwordReset && !submitError && (
        <p role="status" className="mt-4 rounded-md bg-canvas px-3 py-2 text-sm text-muted">
          Sua sessão foi encerrada. Entre novamente.
        </p>
      )}
      {state?.passwordReset && !submitError && (
        <SuccessAlert message="Senha redefinida. Entre com a nova senha." className="mt-4" />
      )}
      {submitError && <ErrorAlert message={submitError} className="mt-4" />}

      {step === "email" ? (
        <form onSubmit={handleEmailSubmit} noValidate className="mt-5 space-y-4">
          <Field id="email" label="E-mail" error={fieldErrors.email}>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="voce@empresa.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
                setSemConta(null);
              }}
              invalid={!!fieldErrors.email}
            />
          </Field>

          {semConta && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-sm text-muted"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {semConta}{" "}
                <Link to="/register" className="font-medium text-accent hover:underline">
                  Criar uma conta
                </Link>
              </span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={checkEmailMutation.isPending}>
            {checkEmailMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {checkEmailMutation.isPending ? "Verificando..." : "Continuar"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSenhaSubmit} noValidate className="mt-5 space-y-4">
          {/* lets password managers pair the senha with this email */}
          <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-canvas px-3 py-2 text-sm">
            <span className="truncate text-ink">{email}</span>
            <button
              type="button"
              onClick={backToEmail}
              disabled={loginMutation.isPending}
              className="shrink-0 font-medium text-accent hover:underline disabled:opacity-50"
            >
              Trocar
            </button>
          </div>

          <Field id="senha" label="Senha" error={fieldErrors.senha}>
            <Input
              id="senha"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={senha}
              onChange={(e) => {
                setSenha(e.target.value);
                setFieldErrors((prev) => ({ ...prev, senha: undefined }));
              }}
              invalid={!!fieldErrors.senha}
            />
          </Field>
          <div className="-mt-2 text-right">
            <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
              Esqueceu a senha?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loginMutation.isPending ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};
