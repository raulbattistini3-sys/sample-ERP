import { z } from "zod";
import { CreateUserSchema } from "../../utils/schemas/user.schema";
import { UsuarioResponseDto } from "./usuario_response.dto";

// POST /user body (before defaults: permissoes and ativo may be missing)
type PayloadCreateUsuario = z.input<typeof CreateUserSchema>;

type ResponseCreateUsuario = UsuarioResponseDto;

export { PayloadCreateUsuario, ResponseCreateUsuario };
