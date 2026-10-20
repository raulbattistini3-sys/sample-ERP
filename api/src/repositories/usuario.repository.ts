import { and, eq, sql } from "drizzle-orm";
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

export const LAST_ACTIVE_SU_MESSAGE = "Não é possível remover o último superusuário (SU) ativo";

// thrown inside a transaction to roll it back while keeping the Either's error
class RollbackWith extends Error {
  constructor(readonly reason: BaseAppError) {
    super(reason.message);
  }
}

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
    payload: Omit<UsuarioEntity, "id" | "sessaoVersao">,
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

  // Runs `write` (which may demote, deactivate or delete targetId) in one transaction that first locks
  // every active SU row with SELECT ... FOR UPDATE. If targetId is the only active SU, nothing is written.
  // A concurrent call blocks on those row locks until this one commits; Postgres then re-checks the rows
  // it waited on and skips any that stopped matching (no longer SU/ativo), so the second call sees the
  // first one's change. Two SUs removing each other at once can't leave the system without one.
  async writeKeepingAnActiveSu(
    targetId: string,
    write: (repository: IUsuarioRepository) => Promise<Either<BaseAppError, null>>,
  ): Promise<Either<BaseAppError, null>> {
    try {
      return await this.db.transaction(async (tx: DrizzleDB) => {
        const activeSus = await tx
          .select({ id: usuarios.id })
          .from(usuarios)
          .where(and(eq(usuarios.permissoes, "SU"), eq(usuarios.ativo, true)))
          .for("update");
        const targetIsActiveSu = activeSus.some((su: { id: string }) => su.id === targetId);
        if (targetIsActiveSu && activeSus.length === 1) {
          return left(new ValidationError("409", LAST_ACTIVE_SU_MESSAGE));
        }
        // same class bound to the transaction, so the write runs under the locks taken above
        const txRepository = new (this.constructor as new (db: DrizzleDB) => IUsuarioRepository)(tx);
        const result = await write(txRepository);
        if (result.isLeft()) {
          throw new RollbackWith(result.value);
        }
        return result;
      });
    } catch (error) {
      if (error instanceof RollbackWith) {
        return left(error.reason);
      }
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
