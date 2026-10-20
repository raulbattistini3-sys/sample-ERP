import { UsuarioEntity } from "../../entities/usuario.entity";

// how every usuario endpoint returns a usuario: never includes senha (the password hash)
type UsuarioResponseDto = Pick<UsuarioEntity, "id" | "nome" | "email" | "permissoes" | "ativo">;

export { UsuarioResponseDto };
