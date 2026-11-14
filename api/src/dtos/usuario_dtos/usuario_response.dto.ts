import { UsuarioEntity } from "../../entities/usuario.entity";

// how every usuario endpoint returns a usuario: never includes senha (the password hash)
type UsuarioResponseDto = Pick<
   UsuarioEntity,
   "id" | "nome" | "email" | "permissoes" | "ativo" | "trocaSenhaObrigatoria" | "efetivo"
> & {
   // from the vault, when the response carries them: masked in listings ("***.456.789-**", "1990-**-**"),
   // in full on GET /user/:id. null = none on file; absent = not asked for or the vault is unreachable
   cpf?: string | null;
   dataNascimento?: string | null;
};

export { UsuarioResponseDto };
