import { PayloadUpdateUsuarioDto } from "../../dtos/usuario_dtos/update_usuario.dto";
import { UsuarioEntity } from "../../entities/usuario.entity";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

interface IUsuarioRepository {
   getUsuario(id: string): Promise<Either<BaseAppError, UsuarioEntity>>;
   getUsuarioByEmail(email: string): Promise<Either<BaseAppError, UsuarioEntity>>;
   getUsuarios(): Promise<Either<BaseAppError, UsuarioEntity[]>>;
   createUsuario(
      payload: Omit<UsuarioEntity, "id" | "auditorias_realizadas">,
   ): Promise<Either<BaseAppError, UsuarioEntity>>;
   updateUsuario(
      payload: PayloadUpdateUsuarioDto,
   ): Promise<Either<BaseAppError, null>>;
   deleteUsuario(id: string): Promise<Either<BaseAppError, null>>;
}

export default IUsuarioRepository;
