import { UsuarioEntity } from "../../entities/usuario.entity";
import { UsuarioResponseDto } from "./usuario_response.dto";

type PayloadRegisterUsuarioDto = Pick<UsuarioEntity, "nome" | "senha"| "email"> &
   Partial<Pick<UsuarioEntity, "permissoes" | "ativo">>;

type ResponseRegisterUsuarioDto = UsuarioResponseDto;

export { PayloadRegisterUsuarioDto, ResponseRegisterUsuarioDto };
