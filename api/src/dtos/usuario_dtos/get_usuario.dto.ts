import { BaseMessageGetOne, BaseMessageGet } from "../global_get.dto";
import { UsuarioResponseDto } from "./usuario_response.dto";

type ResponseGetUsuariosDto = BaseMessageGet<UsuarioResponseDto>;

type ResponseFindUsuarioByIdDto = BaseMessageGetOne<UsuarioResponseDto>;

export { ResponseGetUsuariosDto, ResponseFindUsuarioByIdDto };
