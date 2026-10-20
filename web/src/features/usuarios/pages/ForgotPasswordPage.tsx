import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert, SuccessAlert } from "../../../components/ui/PageState";
import { AuthLayout } from "../../../layouts/AuthLayout";
import { getApiErrorMessage } from "../../../lib/api-client";
import { toFieldErrors } from "../../../lib/form";
import { useForgotPassword } from "../hooks/useUsuarios";
import { ForgotPasswordSchema } from "../types/usuario.types";

export const ForgotPasswordPage = () => {
  const forgotMutation = useForgotPassword();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = ForgotPasswordSchema.safeParse({ email: email.trim() });
    if (!result.success) {
      setEmailError(toFieldErrors<"email">(result.error.issues).email);
      return;
    }
    forgotMutation.mutate(result.data.email);
  };

  return (
    <AuthLayout
      title="Esqueceu a senha?"
      subtitle="Informe seu e-mail e enviaremos um link para criar uma nova senha."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {forgotMutation.isSuccess ? (
        // the API answers the same for unknown emails, so this never confirms an account exists
        <SuccessAlert
          className="mt-4"
          message={`${forgotMutation.data} O link expira em 30 minutos. Confira também a caixa de spam.`}
        />
      ) : (
        <>
          {forgotMutation.isError && (
            <ErrorAlert
              className="mt-4"
              message={getApiErrorMessage(forgotMutation.error, "Não foi possível enviar o e-mail. Tente novamente.")}
            />
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            <Field id="email" label="E-mail" error={emailError}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(undefined);
                }}
                invalid={!!emailError}
              />
            </Field>

            <Button type="submit" className="w-full" disabled={forgotMutation.isPending}>
              {forgotMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {forgotMutation.isPending ? "Enviando..." : "Enviar link"}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
};
