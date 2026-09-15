import { UsuarioEntity } from "../../entities/usuario.entity";

type PayloadUpdateUsuarioDto = Omit<UsuarioEntity,  "auditorias_realizadas">;

type ResponseUpdateUsuarioDto = Omit<UsuarioEntity, "id">;

export { PayloadUpdateUsuarioDto, ResponseUpdateUsuarioDto };
