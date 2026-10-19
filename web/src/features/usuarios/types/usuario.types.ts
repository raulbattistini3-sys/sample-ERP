import { z } from "zod/mini";

export const PermissoesEnum = z.enum(["ADM", "Estoque"]);

export const UsuarioSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.email(), // built-in email format check
  permissoes: PermissoesEnum,
  ativo: z.boolean(),
});
export type Usuario = z.infer<typeof UsuarioSchema>;

export const RegisterUsuarioSchema = z.extend(z.pick(UsuarioSchema, { nome: true, email: true }), {
  senha: z.string(),
});
export type RegisterUsuarioPayload = z.infer<typeof RegisterUsuarioSchema>;

export const LoginUsuarioSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  senha: z.string().check(z.minLength(1, "Informe a senha")),
});
export type LoginUsuarioPayload = z.infer<typeof LoginUsuarioSchema>;

// matches ResponseLoginUsuarioDto — parsing strips anything else the API sends back (e.g. senha)
export const LoginResponseSchema = z.extend(UsuarioSchema, {
  token: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const UpdateUsuarioSchema = z.extend(z.omit(UsuarioSchema, { ativo: true }), {
  ativo: z.optional(z.boolean()),
});
export type UpdateUsuarioPayload = z.infer<typeof UpdateUsuarioSchema>;
