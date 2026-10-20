import { and, count, eq, ne, sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { usuarios } from "../db/schema/usuario.schema";
import { UsuarioEntity } from "../entities/usuario.entity";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import { BaseAppError } from "../errors/global_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { pgErrorCode } from "../utils/helpers/pg_error.util";

// the insert/update raced past the service's email check and hit usuarios_email_lower_unique
const UNIQUE_VIOLATION = "23505";

class UsuarioRepository implements IUsuarioRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getUsuario(id: string): Promise<Either<BaseAppError, UsuarioEntity>> {
    try {
      if (!id) return left(new RepositoryError("No payload found"));
      const [usuario] = await this.db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
      if (!usuario) return left(new RepositoryError("No usuario found"));
      return right(usuario);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async getUsuarioByEmail(email: string): Promise<Either<BaseAppError, UsuarioEntity>> {
    try {
      if (!email) return left(new RepositoryError("No payload found"));
      // case-insensitive, matching the usuarios_email_lower_unique index
      const [usuario] = await this.db
        .select()
        .from(usuarios)
        .where(sql`lower(${usuarios.email}) = lower(${email})`)
        .limit(1);
      if (!usuario) return left(new RepositoryError("No usuario found"));
      return right(usuario);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
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
      return left(new RepositoryError("Database error", error));
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
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return left(new ValidationError("409", "E-mail já cadastrado", error));
      }
      return left(new RepositoryError("Database error", error));
    }
  }

  async updateUsuario(
    payload: UsuarioEntity,
  ): Promise<Either<BaseAppError, null>> {
    try {
      if (!payload) return left(new RepositoryError("No payload found"));
      const [existing] = await this.db.select().from(usuarios).where(eq(usuarios.id, payload.id)).limit(1);
      if (!existing) return left(new RepositoryError("No usuario found"));
      await this.db.update(usuarios).set(payload).where(eq(usuarios.id, payload.id));
      return right(null);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return left(new ValidationError("409", "E-mail já cadastrado", error));
      }
      return left(new RepositoryError("Database error", error));
    }
  }

  async countActiveAdms(exceptId: string): Promise<Either<BaseAppError, number>> {
    try {
      const [row] = await this.db
        .select({ total: count() })
        .from(usuarios)
        .where(and(eq(usuarios.permissoes, "ADM"), eq(usuarios.ativo, true), ne(usuarios.id, exceptId)));
      return right(Number(row?.total ?? 0));
    } catch (error) {
      return left(new RepositoryError("Database error", error));
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
      return left(new RepositoryError("Database error", error));
    }
  }
}

export default UsuarioRepository;
