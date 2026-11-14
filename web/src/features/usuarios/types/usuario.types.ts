import { z } from "zod/mini";

// Estoque < ADM < SU; only an SU manages ADM/SU accounts (enforced by the API)
export const PermissoesEnum = z.enum(["ADM", "Estoque", "SU"]);
export type Permissoes = z.infer<typeof PermissoesEnum>;

export const permissoesLabels: Record<Permissoes, string> = {
  Estoque: "Estoque",
  ADM: "Administrador",
  SU: "Superusuário",
};

export const UsuarioSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.email(), // built-in email format check
  permissoes: PermissoesEnum,
  ativo: z.boolean(),
  // created with a known senha (the first superuser): ProtectedRoute sends it to /trocar-senha
  trocaSenhaObrigatoria: z.optional(z.boolean()),
  efetivo: z.optional(z.boolean()),
  // from the vault: masked in listings ("***.456.789-**", "1990-**-**"), in full for oneself and ADM/SU
  cpf: z.optional(z.nullable(z.string())),
  dataNascimento: z.optional(z.nullable(z.string())),
});
export type Usuario = z.infer<typeof UsuarioSchema>;

export const RegisterUsuarioSchema = z.object({
  nome: z.string().check(z.trim(), z.minLength(1, "Informe o nome")),
  email: z.email("Informe um e-mail válido"),
  senha: z.string().check(z.minLength(6, "A senha deve ter pelo menos 6 caracteres")),
  permissoes: z._default(PermissoesEnum, "Estoque"),
  ativo: z._default(z.boolean(), true),
});
export type RegisterUsuarioPayload = z.infer<typeof RegisterUsuarioSchema>;

export const LoginUsuarioSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  senha: z.string().check(z.minLength(1, "Informe a senha")),
});
export type LoginUsuarioPayload = z.infer<typeof LoginUsuarioSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.email("Informe um e-mail válido"),
});

// the reset page's fields; the token comes from the link's ?token=
export const ResetPasswordFormSchema = z.object({
  senha: z.string().check(z.minLength(6, "A senha deve ter pelo menos 6 caracteres")),
  confirmarSenha: z.string(),
});
export type ResetPasswordFormValues = z.infer<typeof ResetPasswordFormSchema>;

// the change-password page's fields; confirmarSenha never leaves the browser
export const ChangePasswordFormSchema = z.object({
  senhaAtual: z.string().check(z.minLength(1, "Informe a senha atual")),
  novaSenha: z.string().check(z.minLength(6, "A senha deve ter pelo menos 6 caracteres")),
  confirmarSenha: z.string(),
});
export type ChangePasswordFormValues = z.infer<typeof ChangePasswordFormSchema>;

// matches ResponseLoginUsuarioDto — parsing strips anything else the API sends back (e.g. senha)
export const LoginResponseSchema = z.extend(UsuarioSchema, {
  token: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const UpdateUsuarioSchema = z.object({
  id: z.string(),
  nome: z.string().check(z.trim(), z.minLength(1, "Informe o nome")),
  email: z.email("Informe um e-mail válido"),
  permissoes: PermissoesEnum,
  ativo: z.optional(z.boolean()),
  // PUT takes the full entity; only sent when the admin types a new one
  senha: z.optional(z.string().check(z.minLength(6, "A senha deve ter pelo menos 6 caracteres"))),
});
export type UpdateUsuarioPayload = z.infer<typeof UpdateUsuarioSchema>;
