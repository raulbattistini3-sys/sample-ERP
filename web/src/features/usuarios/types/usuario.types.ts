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

export const RegisterUsuarioSchema = UsuarioSchema.pick({ nome: true, email: true }).extend({
  senha: z.string(),
});
export type RegisterUsuarioPayload = z.infer<typeof RegisterUsuarioSchema>;

export const LoginUsuarioSchema = z.object({
  email: z.email(),
  senha: z.string(),
});
export type LoginUsuarioPayload = z.infer<typeof LoginUsuarioSchema>;

export const UpdateUsuarioSchema = UsuarioSchema.omit({ ativo: true }).extend({
  ativo: z.optional(z.boolean()),
});
export type UpdateUsuarioPayload = z.infer<typeof UpdateUsuarioSchema>;
