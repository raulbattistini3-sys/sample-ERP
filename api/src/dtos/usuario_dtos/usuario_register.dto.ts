import { UsuarioEntity } from "../../entities/usuario.entity";

type PayloadRegisterUsuarioDto = Pick<UsuarioEntity, "nome" | "senha"| "email">;

type ResponseRegisterUsuarioDto = Omit<UsuarioEntity, "auditorias_realizadas">;

export { PayloadRegisterUsuarioDto, ResponseRegisterUsuarioDto };
