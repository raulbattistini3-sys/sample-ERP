import { desc, eq, isNull } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { auditorias } from "../db/schema/auditoria.schema";
import { detalhamentosAuditoria } from "../db/schema/detalhamento_auditoria.schema";
import { produtosPorAuditoria } from "../db/schema/produtos_por_auditoria.schema";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import IAuditoryRepository from "../interfaces/auditory_interfaces/auditoria_repository.interface";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { pgErrorCode } from "../utils/helpers/pg_error.util";
import { enqueueForProducts } from "./jira_outbox.repository";
import { NewAuditoriaWithItens } from "../dtos/auditoria_dtos/create_auditoria.dto";
import { GetUserPreviousAudictionsDto } from "../dtos/auditoria_dtos/get_auditoria.dto";

class AuditoriaRepository implements IAuditoryRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getAuditorias(): Promise<Either<RepositoryError, AuditoriaEntity[]>> {
    try {
      // newest first, so paging walks back in time
      const auditoriasData = await this.db
        .select()
        .from(auditorias)
        .where(isNull(auditorias.deletedAt))
        .orderBy(desc(auditorias.dataDeAudicao));
      return right(auditoriasData);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async getAuditoriaById(id: string): Promise<Either<BaseAppError, AuditoriaEntity>> {
    try {
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new ValidationError("404", "Auditoria não encontrada"));
      }
      return right(auditoria);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  // detalhamento, auditoria and its produtos are written together or not at all
  async createAuditoria({
    auditoria,
    detalhamento,
    produtoIds,
  }: NewAuditoriaWithItens): Promise<Either<BaseAppError, AuditoriaEntity>> {
    try {
      const created = await this.db.transaction(async (tx: DrizzleDB) => {
        const [detalhamentoRow] = await tx.insert(detalhamentosAuditoria).values(detalhamento).returning();
        const [auditoriaRow] = await tx
          .insert(auditorias)
          .values({ ...auditoria, detalhamentoAuditoriaId: detalhamentoRow.id })
          .returning();
        await tx
          .insert(produtosPorAuditoria)
          .values(produtoIds.map((produtoId) => ({ auditoriaId: auditoriaRow.id, produtoId })));
        // one Jira issue per categoria of these products (when Jira is connected), sent after commit
        await enqueueForProducts(tx, auditoriaRow.id, produtoIds);
        return auditoriaRow;
      });
      return right(created);
    } catch (error) {
      // foreign key violation: the usuario or one of the produtos doesn't exist
      if (pgErrorCode(error) === "23503") {
        return left(new ValidationError("404", "Usuário auditor ou produto não encontrado", error));
      }
      return left(new RepositoryError("Database error", error));
    }
  }

  async updateAuditoria(auditoria: AuditoriaEntity): Promise<Either<RepositoryError, null>> {
    try {
      if (!auditoria) {
        return left(new RepositoryError("No payload found"));
      }
      const [existing] = await this.db.select().from(auditorias).where(eq(auditorias.id, auditoria.id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("No auditoria found"));
      }
      await this.db.update(auditorias).set(auditoria).where(eq(auditorias.id, auditoria.id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async userPreviousAudictions(userId: string): Promise<Either<RepositoryError, AuditoriaEntity[]>> {
    try {
      if (!userId) {
        return left(new RepositoryError("No userId provided"));
      }
      const auditoriasData = await this.db
        .select()
        .from(auditorias)
        .where(eq(auditorias.usuarioId, userId));
      if (!auditoriasData || auditoriasData.length === 0) {
        return left(new RepositoryError("No auditorias found"));
      }
      return right(auditoriasData);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async getRespectivoDetalhamentosAuditoriaById(id: string): Promise<Either<RepositoryError, AuditoriaEntity>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id provided"));
      }
      const auditoria = await this.db.query.auditorias.findFirst({
        where: (auditorias, { eq }) => eq(auditorias.id, id),
        with: { detalhamento: true },
      });
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      return right(auditoria);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async deleteAuditoria(id: string): Promise<Either<RepositoryError, null>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id provided"));
      }
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      await this.db.delete(auditorias).where(eq(auditorias.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async softDeleteAuditoria(id: string): Promise<Either<RepositoryError, null>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id provided"));
      }
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      await this.db.update(auditorias).set({ deletedAt: new Date() }).where(eq(auditorias.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }
}

export default AuditoriaRepository;
