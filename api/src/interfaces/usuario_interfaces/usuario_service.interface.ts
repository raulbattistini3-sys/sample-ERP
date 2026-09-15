import { ResponseArchiveUsuario } from "../../dtos/usuario_dtos/delete_usuario.dto";
import {
   ResponseFindUsuarioByIdDto,
   ResponseGetUsuariosDto,
} from "../../dtos/usuario_dtos/get_usuario.dto";
import {
   PayloadCreateUsuario,
   ResponseCreateUsuario,
} from "../../dtos/usuario_dtos/create_usuario.dto";
import { PayloadUpdateUsuarioDto } from "../../dtos/usuario_dtos/update_usuario.dto";
import {
   PayloadLoginUsuarioDto,
   ResponseLoginUsuarioDto,
} from "../../dtos/usuario_dtos/usuario_login.dto";
import {
   PayloadRegisterUsuarioDto,
   ResponseRegisterUsuarioDto,
} from "../../dtos/usuario_dtos/usuario_register.dto";
import { Either } from "../../globals/errors/left_right_either.error";
import { BaseAppError } from "../../errors/global_error.error";

interface IUsuarioService {
   getUsers: (
      page: number,
      amount: number,
   ) => Promise<Either<BaseAppError, ResponseGetUsuariosDto>>;
   findUserById: (
      id: string,
   ) => Promise<Either<BaseAppError, ResponseFindUsuarioByIdDto>>;
   createUsuario: (
      payload: PayloadCreateUsuario,
   ) => Promise<Either<BaseAppError, ResponseCreateUsuario>>;
   updateUser: (
      id: string,
      payload: PayloadUpdateUsuarioDto,
   ) => Promise<Either<BaseAppError, null>>;
   deleteUser: (id: string) => Promise<Either<BaseAppError, null>>;
   archiveUser: (
      id: string,
   ) => Promise<Either<BaseAppError, ResponseArchiveUsuario>>;
   loginUsuario: (
      payload: PayloadLoginUsuarioDto,
   ) => Promise<Either<BaseAppError, ResponseLoginUsuarioDto>>;
   registerUsuario: (
      payload: PayloadRegisterUsuarioDto,
   ) => Promise<Either<BaseAppError, ResponseRegisterUsuarioDto>>;
}

export default IUsuarioService;
