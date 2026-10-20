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
import { toUsuarioResponse } from "../mappers/usuario.mapper";
import { UsuarioResponseDto } from "../dtos/usuario_dtos/usuario_response.dto";
import { isAdminRole, isSu } from "../utils/helpers/permissoes.util";
import permissoesUsuarioEnum from "../enums/usuarios_permissoes.enum";

const onlySuError = () =>
   new ValidationError("403", "Apenas superusuários (SU) podem gerenciar administradores");

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
         const validation = this.userValidator.validatePageAndAmount(
            page,
            amount,
         );
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const usuarios = await this.userRepository.getUsuarios();
         if (usuarios.isLeft()) {
            return left(usuarios.value);
         }
         const paginatedData = paginate(usuarios.value, page, amount);
         const response: ResponseGetUsuariosDto = {
            data: paginatedData.data.map(toUsuarioResponse),
            pageNumber: paginatedData.currentPage,
            totalItems: paginatedData.totalItems,
            pageSize: paginatedData.perPage,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, undefined, error));
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
            data: toUsuarioResponse(userData.value),
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, undefined, error));
      }
   }
   async createUsuario(
      payload: PayloadCreateUsuario,
      actor: UsuarioResponseDto,
   ): Promise<Either<BaseAppError, ResponseCreateUsuario>> {
      try {
         const validation = this.userValidator.validateCreatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         if (isAdminRole(payload.permissoes) && !isSu(actor.permissoes)) {
            return left(onlySuError());
         }
         const emailCheck = await this.ensureEmailAvailable(payload.email);
         if (emailCheck.isLeft()) {
            return left(emailCheck.value);
         }
         const userData = await this.userRepository.createUsuario({
            nome: payload.nome,
            email: payload.email,
            senha: await hashPassword(payload.senha),
            permissoes: payload.permissoes ?? permissoesUsuarioEnum.Values.Estoque,
            ativo: payload.ativo ?? true,
         });
         if (userData.isLeft()) {
            if (userData.value instanceof ValidationError) {
               return left(userData.value);
            }
            return left(
               new ServerError("500", true, "internal server error", userData.value),
            );
         }
         const response: ResponseCreateUsuario = toUsuarioResponse(userData.value);
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, undefined, error));
      }
   }
   async updateUser(
      id: string,
      payload: PayloadUpdateUsuarioDto,
      actor: UsuarioResponseDto,
   ): Promise<Either<BaseAppError, null>> {
      try {
         const idValidation = this.userValidator.validateUUIDv4(id);
         if (idValidation.isLeft()) {
            return left(idValidation.value);
         }
         const validation = this.userValidator.validateUpdatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const existing = await this.findExisting(id);
         if (existing.isLeft()) {
            return left(existing.value);
         }
         const emailCheck = await this.ensureEmailAvailable(payload.email, id);
         if (emailCheck.isLeft()) {
            return left(emailCheck.value);
         }
         const nextAtivo = payload.ativo ?? existing.value.ativo;
         // an ADM manages Estoque accounts; on ADM/SU accounts (or to grant ADM/SU) only SU may act.
         // An ADM may still edit their own nome/email/senha, as long as role and status stay the same
         const touchesAdminAccount =
            isAdminRole(existing.value.permissoes) || isAdminRole(payload.permissoes);
         const isOwnProfileEdit =
            existing.value.id === actor.id &&
            payload.permissoes === existing.value.permissoes &&
            nextAtivo === existing.value.ativo;
         if (touchesAdminAccount && !isSu(actor.permissoes) && !isOwnProfileEdit) {
            return left(onlySuError());
         }
         const row: UsuarioEntity = {
            id,
            nome: payload.nome,
            email: payload.email,
            permissoes: payload.permissoes,
            ativo: nextAtivo,
            // keep the current hash unless a new senha was sent
            senha: payload.senha
               ? await hashPassword(payload.senha)
               : existing.value.senha,
            // a new senha ends every session opened with the old one
            sessaoVersao: existing.value.sessaoVersao + (payload.senha ? 1 : 0),
         };
         // only a change that leaves the usuario without active SU rights needs the guard
         const removesSu = !isSu(payload.permissoes) || !nextAtivo;
         const updated = removesSu
            ? await this.userRepository.writeKeepingAnActiveSu(id, (repository) =>
                 repository.updateUsuario(row),
              )
            : await this.userRepository.updateUsuario(row);
         if (updated.isLeft()) {
            if (updated.value instanceof ValidationError) {
               return left(updated.value);
            }
            return left(new ServerError("500", true, undefined, updated.value));
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, undefined, error));
      }
   }

   async deleteUser(id: string, actor: UsuarioResponseDto): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.userValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const userData = await this.findExisting(id);
         if (userData.isLeft()) {
            return left(userData.value);
         }
         if (isAdminRole(userData.value.permissoes) && !isSu(actor.permissoes)) {
            return left(onlySuError());
         }
         const userDeletion = await this.userRepository.writeKeepingAnActiveSu(
            id,
            (repository) => repository.deleteUsuario(id),
         );
         if (userDeletion.isLeft()) {
            return left(userDeletion.value);
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, undefined, error));
      }
   }
   async archiveUser(
      id: string,
      actor: UsuarioResponseDto,
   ): Promise<Either<BaseAppError, ResponseArchiveUsuario>> {
      try {
         const validation = this.userValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const userData = await this.findExisting(id);
         if (userData.isLeft()) {
            return left(userData.value);
         }
         const userClass = userData.value;
         if (isAdminRole(userClass.permissoes) && !isSu(actor.permissoes)) {
            return left(onlySuError());
         }
         let userToUpdate: UsuarioEntity = {
            id,
            ativo: false,
            senha: userClass.senha,
            sessaoVersao: userClass.sessaoVersao,
            nome: userClass.nome,
            permissoes: userClass.permissoes,
            email: userClass.email,
         };
         const userArchiving = await this.userRepository.writeKeepingAnActiveSu(
            id,
            (repository) => repository.updateUsuario(userToUpdate),
         );
         if (userArchiving.isLeft()) {
            return left(userArchiving.value);
         }
         return right(toUsuarioResponse({ ...userClass, ativo: false }));
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, undefined, error));
      }
   }
  async loginUsuario(
   payload: PayloadLoginUsuarioDto,
): Promise<Either<BaseAppError, ResponseLoginUsuarioDto>> {
   try {
      const validation = this.userValidator.validateLoginPayload(payload);
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
      // checked after the password, so it doesn't reveal which emails exist
      if (!userData.value.ativo) {
         return left(new ValidationError("401", "Usuário inativo"));
      }
      const token = generateToken(userData.value);
      const response: ResponseLoginUsuarioDto = { ...toUsuarioResponse(userData.value), token };
      return right(response);
   } catch (error) {
      if (error instanceof ValidationError) {
         return left(error);
      }
      return left(new ServerError("500", true, undefined, error));
   }
}

// sliding session: a signed-in, active usuario trades its token for a new one
refreshToken(usuario: UsuarioResponseDto, sessaoVersao: number): ResponseLoginUsuarioDto {
   return { ...usuario, token: generateToken({ ...usuario, sessaoVersao }) };
}

async registerUsuario(
   payloadUsuario: PayloadRegisterUsuarioDto,
): Promise<Either<BaseAppError, ResponseRegisterUsuarioDto>> {
   try {
      const validation = this.userValidator.validateRegisterPayload(payloadUsuario);
      if (validation.isLeft()) {
         return left(validation.value);
      }
      const emailCheck = await this.ensureEmailAvailable(payloadUsuario.email);
      if (emailCheck.isLeft()) {
         return left(emailCheck.value);
      }
      const hashed = await hashPassword(payloadUsuario.senha);
      const userData = await this.userRepository.createUsuario({
         nome: payloadUsuario.nome,
         email: payloadUsuario.email,
         senha: hashed,
         // self-registration is public: never trust permissoes/ativo from the body
         // (an ADM promotes users through PUT /user/:id)
         permissoes: permissoesUsuarioEnum.Values.Estoque,
         ativo: true,
      });
      if (userData.isLeft()) {
         return left(userData.value);
      }
      return right(toUsuarioResponse(userData.value));
   } catch (error) {
      if (error instanceof ValidationError) {
         return left(error);
      }
      return left(new ServerError("500", true, undefined, error));
   }
  }

  // emails identify usuarios at login, so two accounts can't share one; exceptId lets an update keep its own
  private async ensureEmailAvailable(
     email: string,
     exceptId?: string,
  ): Promise<Either<BaseAppError, null>> {
     const existing = await this.userRepository.getUsuarioByEmail(email);
     if (existing.isRight()) {
        return existing.value.id === exceptId
           ? right(null)
           : left(new ValidationError("409", "E-mail já cadastrado"));
     }
     // a cause means the lookup itself failed; without one the email is free
     if (existing.value.cause) {
        return left(new ServerError("500", true, undefined, existing.value));
     }
     return right(null);
  }

  // 404 when the usuario doesn't exist, 500 when the lookup itself failed
  private async findExisting(id: string): Promise<Either<BaseAppError, UsuarioEntity>> {
     const existing = await this.userRepository.getUsuario(id);
     if (existing.isRight()) {
        return existing;
     }
     if (existing.value.cause) {
        return left(new ServerError("500", true, undefined, existing.value));
     }
     return left(new ValidationError("404", "Usuário não encontrado"));
  }
}

export default UsuarioService;
