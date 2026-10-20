import { UsuarioEntity } from "../../entities/usuario.entity";
import { UsuarioResponseDto } from "./usuario_response.dto";

type PayloadCreateUsuario = Omit<UsuarioEntity, "id">;

type ResponseCreateUsuario = UsuarioResponseDto;

export { PayloadCreateUsuario, ResponseCreateUsuario };
