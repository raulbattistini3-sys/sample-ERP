import { DataSource, Repository } from "typeorm";
import { UsuarioEntity } from "../entities/usuario.entity";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import { BaseAppError } from "../errors/global_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { PayloadUpdateUsuarioDto } from "../dtos/usuario_dtos/update_usuario.dto";

class UsuarioRepository implements IUsuarioRepository {
   private repository: Repository<UsuarioEntity>;
   constructor(private readonly connection: DataSource) {
      this.repository = this.connection.getRepository(UsuarioEntity);
   }
   async getUsuario(id: string): Promise<Either<BaseAppError, UsuarioEntity>> {
      try {
         if (!id) {
            return left(new RepositoryError("No payload found"));
         }
         const usuario = await this.repository.findOne({ where: { id } });
         if (!usuario) {
            return left(new RepositoryError("No usuario found"));
         }
         return right(usuario);
      } catch (error) {
         return left(new RepositoryError("Database error"));
      }
   }
   async getUsuarioByEmail(email: string): Promise<Either<BaseAppError, UsuarioEntity>> {
      try {
         if (!email) {
            return left(new RepositoryError("No payload found"));
         }
         const usuario = await this.repository.findOne({ where: { email } });
         if (!usuario) {
            return left(new RepositoryError("No usuario found"));
         }
         return right(usuario);
      } catch (error) {
         return left(new RepositoryError("Database error"));
      }
   }
   async getUsuarios(): Promise<Either<BaseAppError, UsuarioEntity[]>> {
      try {
         const usuarios = await this.repository.find();
         if (!usuarios || usuarios.length === 0) {
            return left(new RepositoryError("No usuario found"));
         }
         return right(usuarios);
      } catch (error) {
         return left(new RepositoryError("Database error"));
      }
   }
   async createUsuario(
      payload: Omit<UsuarioEntity, "id">,
   ): Promise<Either<BaseAppError, UsuarioEntity>> {
      try {
         if (!payload) {
            return left(new RepositoryError("No payload found"));
         }
         let usuario = this.repository.create(payload);
         usuario = await this.repository.save(usuario);
         return right(usuario);
      } catch (error) {
         return left(new RepositoryError("Database error"));
      }
   }
   async updateUsuario(
      payload: PayloadUpdateUsuarioDto,
   ): Promise<Either<BaseAppError, null>> {
      try {
         if (!payload) {
            return left(new RepositoryError("No payload found"));
         }
         let usuario = await this.repository.findOne({
            where: { id: payload.id },
         });
         if (!usuario) {
            return left(new RepositoryError("No usuario found"));
         }
         const usuarioToUpdate = await this.repository.findOne({
            where: { id: usuario.id },
         });
         if (!usuarioToUpdate) {
            return left(new RepositoryError("No usuario found"));
         }
         await this.repository.update(usuario.id, usuarioToUpdate);
         return right(null);
      } catch (error) {
         return left(new RepositoryError("Database error"));
      }
   }
   async deleteUsuario(id: string): Promise<Either<BaseAppError, null>> {
      try {
         if (!id) {
            return left(new RepositoryError("No payload found"));
         }
         const usuario = await this.repository.findOne({ where: { id } });
         if (!usuario) {
            return left(new RepositoryError("No usuario found"));
         }
         const usuarioToDelete = await this.repository.findOne({
            where: { id },
         });
         if (!usuarioToDelete) {
            return left(new RepositoryError("No usuario found"));
         }
         await this.repository.delete(usuarioToDelete.id);
         return right(null);
      } catch (error) {
         return left(new RepositoryError("Database error"));
      }
   }
}

export default UsuarioRepository;
