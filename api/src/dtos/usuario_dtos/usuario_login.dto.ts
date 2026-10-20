import { UsuarioEntity } from "../../entities/usuario.entity";
import { UsuarioResponseDto } from "./usuario_response.dto";

type PayloadLoginUsuarioDto = Pick<UsuarioEntity, "id" | "email" | "senha">;
type ResponseLoginUsuarioDto = UsuarioResponseDto & {
    token: string;
};

export { PayloadLoginUsuarioDto, ResponseLoginUsuarioDto };