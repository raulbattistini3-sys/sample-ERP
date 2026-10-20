import { UsuarioResponseDto } from "../dtos/usuario_dtos/usuario_response.dto";
import { UsuarioEntity } from "../entities/usuario.entity";

// picks the public fields explicitly, so senha (or any column added later) never leaks
export const toUsuarioResponse = (usuario: UsuarioEntity): UsuarioResponseDto => ({
   id: usuario.id,
   nome: usuario.nome,
   email: usuario.email,
   permissoes: usuario.permissoes,
   ativo: usuario.ativo,
});
