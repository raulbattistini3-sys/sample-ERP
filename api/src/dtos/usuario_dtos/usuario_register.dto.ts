import { UsuarioEntity } from "../../entities/usuario.entity";

type PayloadRegisterUsuarioDto = Pick<UsuarioEntity, "nome" | "senha"| "email"> &
   Partial<Pick<UsuarioEntity, "permissoes" | "ativo">>;

type ResponseRegisterUsuarioDto = Omit<UsuarioEntity, "auditorias_realizadas">;

export { PayloadRegisterUsuarioDto, ResponseRegisterUsuarioDto };
