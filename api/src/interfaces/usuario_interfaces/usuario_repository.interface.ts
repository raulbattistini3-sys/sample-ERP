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
   // payload is the full row to save (senha already hashed)
   updateUsuario(
      payload: UsuarioEntity,
   ): Promise<Either<BaseAppError, null>>;
   deleteUsuario(id: string): Promise<Either<BaseAppError, null>>;
   // runs write in a transaction that locks the active ADM rows; 409 (nothing written)
   // when targetId is the only active ADM
   writeKeepingAnActiveAdm(
      targetId: string,
      write: (repository: IUsuarioRepository) => Promise<Either<BaseAppError, null>>,
   ): Promise<Either<BaseAppError, null>>;
}

export default IUsuarioRepository;
