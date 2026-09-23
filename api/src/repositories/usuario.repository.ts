import { eq } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { usuarios } from "../db/schema/usuario.schema";
import { UsuarioEntity } from "../entities/usuario.entity";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import { BaseAppError } from "../errors/global_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { PayloadUpdateUsuarioDto } from "../dtos/usuario_dtos/update_usuario.dto";

class UsuarioRepository implements IUsuarioRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getUsuario(id: string): Promise<Either<BaseAppError, UsuarioEntity>> {
    try {
      if (!id) return left(new RepositoryError("No payload found"));
      const [usuario] = await this.db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
      if (!usuario) return left(new RepositoryError("No usuario found"));
      return right(usuario);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async getUsuarioByEmail(email: string): Promise<Either<BaseAppError, UsuarioEntity>> {
    try {
      if (!email) return left(new RepositoryError("No payload found"));
      const [usuario] = await this.db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
      if (!usuario) return left(new RepositoryError("No usuario found"));
      return right(usuario);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async getUsuarios(): Promise<Either<BaseAppError, UsuarioEntity[]>> {
    try {
      const usuariosData = await this.db.select().from(usuarios);
      if (!usuariosData || usuariosData.length === 0) {
        return left(new RepositoryError("No usuario found"));
      }
      return right(usuariosData);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async createUsuario(
    payload: Omit<UsuarioEntity, "id">,
  ): Promise<Either<BaseAppError, UsuarioEntity>> {
    try {
      if (!payload) return left(new RepositoryError("No payload found"));
      const [usuario] = await this.db.insert(usuarios).values(payload).returning();
      return right(usuario);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async updateUsuario(
    payload: PayloadUpdateUsuarioDto,
  ): Promise<Either<BaseAppError, null>> {
    try {
      if (!payload) return left(new RepositoryError("No payload found"));
      const [existing] = await this.db.select().from(usuarios).where(eq(usuarios.id, payload.id)).limit(1);
      if (!existing) return left(new RepositoryError("No usuario found"));
      await this.db.update(usuarios).set(payload).where(eq(usuarios.id, payload.id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async deleteUsuario(id: string): Promise<Either<BaseAppError, null>> {
    try {
      if (!id) return left(new RepositoryError("No payload found"));
      const [existing] = await this.db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
      if (!existing) return left(new RepositoryError("No usuario found"));
      await this.db.delete(usuarios).where(eq(usuarios.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }
}

export default UsuarioRepository;
