import IUserService from "../interfaces/usuario_interfaces/usuario_service.interface";
import { ResponseArchiveUsuario } from "../dtos/usuario_dtos/delete_usuario.dto";
import {
   ResponseFindUsuarioByIdDto,
   ResponseGetUsuariosDto,
} from "../dtos/usuario_dtos/get_usuario.dto";
import { PayloadUpdateUsuarioDto } from "../dtos/usuario_dtos/update_usuario.dto";
import {
   PayloadCreateUsuario,
   ResponseCreateUsuario,
} from "../dtos/usuario_dtos/create_usuario.dto";
import {
   PayloadLoginUsuarioDto,
   ResponseLoginUsuarioDto,
} from "../dtos/usuario_dtos/usuario_login.dto";
import {
   PayloadRegisterUsuarioDto,
   ResponseRegisterUsuarioDto,
} from "../dtos/usuario_dtos/usuario_register.dto";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import { IUsuarioValidator } from "../interfaces/usuario_interfaces/usuario_validator.interface";
import paginate from "../utils/helpers/paginate_data.helper";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { UsuarioEntity } from "../entities/usuario.entity";
import { comparePassword, hashPassword } from "../utils/helpers/password.util";
import { generateToken } from "../utils/helpers/token.util";
import permissoesUsuarioEnum from "../enums/usuarios_permissoes.enum";

class UsuarioService implements IUserService {
     constructor(
      private userRepository: IUsuarioRepository,
      private userValidator: IUsuarioValidator,
   ) {}
   async getUsers(
      page: number,
      amount: number,
   ): Promise<Either<BaseAppError, ResponseGetUsuariosDto>> {
      try {
         const validation = this.userValidator.validatePayload({
            page,
            amount,
         });
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const usuarios = await this.userRepository.getUsuarios();
         if (usuarios.isLeft()) {
            return left(usuarios.value);
         }
         const paginatedData = paginate(
            usuarios.value,
            1,
            usuarios.value.length,
         );
         const response: ResponseGetUsuariosDto = {
            data: usuarios.value,
            pageNumber: paginatedData.currentPage,
            totalItems: paginatedData.totalItems,
            pageSize: paginatedData.perPage,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true));
      }
   }
   async findUserById(
      id: string,
   ): Promise<Either<BaseAppError, ResponseFindUsuarioByIdDto>> {
      try {
         const validation = this.userValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const userData = await this.userRepository.getUsuario(id);
         if (userData.isLeft()) {
            return left(userData.value);
         }
         const response: ResponseFindUsuarioByIdDto = {
            data: userData.value,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true));
      }
   }
   async createUsuario(
      payload: PayloadCreateUsuario,
   ): Promise<Either<BaseAppError, ResponseCreateUsuario>> {
      try {
         const validation = this.userValidator.validatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const userData = await this.userRepository.createUsuario(payload);
         if (userData.isLeft()) {
            if (userData.value instanceof ValidationError) {
               return left(userData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         const response: ResponseCreateUsuario = userData.value;
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true));
      }
   }
  async updateUser(id: string, payload: PayloadUpdateUsuarioDto): Promise<Either<BaseAppError, null>> {
   try {
      if (!payload) {
         return left(new RepositoryError("No payload found"));
      }
      const usuario = await this.userRepository.getUsuario(payload.id)
      if (!usuario) {
         return left(new RepositoryError("No usuario found"));
      }
      await this.userRepository.updateUsuario(usuario.value as UsuarioEntity)
      return right(null);
   } catch (error) {
      return left(new RepositoryError("Database error"));
   }
  } async deleteUser(id: string): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.userValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const userData = await this.userRepository.getUsuario(id);
         if (userData.isLeft()) {
            return left(userData.value);
         }
         const userDeletion = await this.userRepository.deleteUsuario(id);
         if (userDeletion.isLeft()) {
            return left(userDeletion.value);
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true));
      }
   }
   async archiveUser(
      id: string,
   ): Promise<Either<BaseAppError, ResponseArchiveUsuario>> {
      try {
         const validation = this.userValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const userData = await this.userRepository.getUsuario(id);
         if (userData.isLeft()) {
            return left(userData.value);
         }
         const userClass = userData.value;
         let userToUpdate: PayloadUpdateUsuarioDto = {
            id,
            ativo: false,
            senha: userClass.senha,
            nome: userClass.nome,
            permissoes: userClass.permissoes,
            email: userClass.email,
         };
         const userArchiving =
            await this.userRepository.updateUsuario(userToUpdate);
         if (userArchiving.isLeft()) {
            return left(userArchiving.value);
         }
         return right(userToUpdate);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true));
      }
   }
  async loginUsuario(
   payload: PayloadLoginUsuarioDto,
): Promise<Either<BaseAppError, ResponseLoginUsuarioDto>> {
   try {
      const validation = this.userValidator.validatePayload(payload);
      if (validation.isLeft()) {
         return left(validation.value);
      }
      const userData = await this.userRepository.getUsuarioByEmail(payload.email);
      if (userData.isLeft()) {
         return left(new ValidationError("401", "credenciais inválidas"));
      }
      const matches = await comparePassword(payload.senha, userData.value.senha);
      if (!matches) {
         return left(new ValidationError("401", "credenciais inválidas"));
      }
      const token = generateToken(userData.value);
      const { senha, auditorias_realizadas, id, ...safeUser } = userData.value;
      const userDataVal = userData.value
      const response: 
        ResponseLoginUsuarioDto = { ...userDataVal, token };
      return right(response);
   } catch (error) {
      if (error instanceof ValidationError) {
         return left(error);
      }
      return left(new ServerError("500", true));
   }
}

async registerUsuario(
   payloadUsuario: PayloadRegisterUsuarioDto,
): Promise<Either<BaseAppError, ResponseRegisterUsuarioDto>> {
   try {
      const validation = this.userValidator.validatePayload(payloadUsuario);
      if (validation.isLeft()) {
         return left(validation.value);
      }
      const hashed = await hashPassword(payloadUsuario.senha);
      const userData = await this.userRepository.createUsuario({
         nome: payloadUsuario.nome,
         email: payloadUsuario.email,
         senha: hashed,
         permissoes: permissoesUsuarioEnum.Values.Estoque,
         ativo: true,
      });
      if (userData.isLeft()) {
         return left(userData.value);
      }
      const { senha, ...safeUser } = userData.value;
      return right(userData.value);
   } catch (error) {
      if (error instanceof ValidationError) {
         return left(error);
      }
      return left(new ServerError("500", true));
   }
  }
}

export default UsuarioService;
