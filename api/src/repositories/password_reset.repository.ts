import { and, eq, isNull, sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { passwordResetTokens } from "../db/schema/password_reset_token.schema";
import { usuarios } from "../db/schema/usuario.schema";
import IPasswordResetRepository from "../interfaces/password_reset_interfaces/password_reset_repository.interface";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";

export const INVALID_RESET_LINK_MESSAGE = "Link de redefinição inválido ou expirado. Peça um novo.";

// thrown inside a transaction to roll it back while keeping the Either's error
class RollbackWith extends Error {
  constructor(readonly reason: BaseAppError) {
    super(reason.message);
  }
}

class PasswordResetRepository implements IPasswordResetRepository {
  constructor(private readonly db: DrizzleDB) {}

  async hasRecentToken(usuarioId: string, seconds: number): Promise<Either<BaseAppError, boolean>> {
    try {
      const [recent] = await this.db
        .select({ id: passwordResetTokens.id })
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.usuarioId, usuarioId),
            sql`${passwordResetTokens.createdAt} > now() - make_interval(secs => ${seconds})`,
          ),
        )
        .limit(1);
      return right(!!recent);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async createToken(usuarioId: string, tokenHash: string, ttlMinutes: number): Promise<Either<BaseAppError, null>> {
    try {
      await this.db.transaction(async (tx: DrizzleDB) => {
        // only the newest link works
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: sql`now()` })
          .where(and(eq(passwordResetTokens.usuarioId, usuarioId), isNull(passwordResetTokens.usedAt)));
        await tx.insert(passwordResetTokens).values({
          usuarioId,
          tokenHash,
          expiresAt: sql`now() + make_interval(mins => ${ttlMinutes})`,
        });
      });
      return right(null);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async consumeToken(tokenHash: string, senhaHash: string): Promise<Either<BaseAppError, null>> {
    try {
      return await this.db.transaction(async (tx: DrizzleDB) => {
        // claiming the row in the UPDATE makes the token single-use even under concurrent requests
        const [claimed] = await tx
          .update(passwordResetTokens)
          .set({ usedAt: sql`now()` })
          .where(
            and(
              eq(passwordResetTokens.tokenHash, tokenHash),
              isNull(passwordResetTokens.usedAt),
              sql`${passwordResetTokens.expiresAt} > now()`,
            ),
          )
          .returning({ usuarioId: passwordResetTokens.usuarioId });
        if (!claimed) {
          return left(new ValidationError("400", INVALID_RESET_LINK_MESSAGE));
        }
        const [updated] = await tx
          .update(usuarios)
          .set({ senha: senhaHash })
          .where(and(eq(usuarios.id, claimed.usuarioId), eq(usuarios.ativo, true)))
          .returning({ id: usuarios.id });
        if (!updated) {
          // deactivated since the link was sent: leave the token unused and the senha untouched
          throw new RollbackWith(new ValidationError("400", INVALID_RESET_LINK_MESSAGE));
        }
        return right(null);
      });
    } catch (error) {
      if (error instanceof RollbackWith) {
        return left(error.reason);
      }
      return left(new RepositoryError("Database error", error));
    }
  }
}

export default PasswordResetRepository;
