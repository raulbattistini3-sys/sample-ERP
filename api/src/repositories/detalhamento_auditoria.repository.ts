import { eq, isNull } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { detalhamentosAuditoria } from "../db/schema/detalhamento_auditoria.schema";
import { DetalhamentoAuditoriaEntity } from "../entities/detalhamento_auditoria.entity";
import IDetalhamentoAuditoriaRepository from "../interfaces/detalhamento_auditoria_interfaces/detalhamento_auditoria_repository.interface";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";

class DetalhamentoAuditoriaRepository implements IDetalhamentoAuditoriaRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getDetalhamentoAuditorias(): Promise<Either<RepositoryError, DetalhamentoAuditoriaEntity[]>> {
    try {
      const data = await this.db
        .select()
        .from(detalhamentosAuditoria)
        .where(isNull(detalhamentosAuditoria.deletedAt)); // exclude soft-deleted rows
      if (!data || data.length === 0) {
        return left(new RepositoryError("No detalhamento auditorias found"));
      }
      return right(data);
    } catch (error) {
      return left(new RepositoryError("Repository error"));
    }
  }

  async getDetalhamentoAuditoriasById(id: string): Promise<Either<RepositoryError, DetalhamentoAuditoriaEntity>> {
    try {
      const [data] = await this.db.select().from(detalhamentosAuditoria).where(eq(detalhamentosAuditoria.id, id)).limit(1);
      if (!data) {
        return left(new RepositoryError("No detalhamento auditoria found"));
      }
      return right(data);
    } catch (error) {
      return left(new RepositoryError("Repository error"));
    }
  }

  async createDetalhamentoAuditoria(
    payload: Omit<DetalhamentoAuditoriaEntity, "id" | "deletedAt">,
  ): Promise<Either<RepositoryError, DetalhamentoAuditoriaEntity>> {
    try {
      if (!payload) {
        return left(new RepositoryError("No payload found"));
      }
      const [data] = await this.db.insert(detalhamentosAuditoria).values(payload).returning();
      return right(data);
    } catch (error) {
      return left(new RepositoryError("Repository error"));
    }
  }

  async updateDetalhamentoAuditoria(
    payload: DetalhamentoAuditoriaEntity,
  ): Promise<Either<RepositoryError, null>> {
    try {
      if (!payload) {
        return left(new RepositoryError("No payload found"));
      }
      const [existing] = await this.db.select().from(detalhamentosAuditoria).where(eq(detalhamentosAuditoria.id, payload.id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("No detalhamento auditoria found"));
      }
      await this.db.update(detalhamentosAuditoria).set(payload).where(eq(detalhamentosAuditoria.id, payload.id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("Repository error"));
    }
  }

  async archiveDetalhamentoAuditoria(id: string): Promise<Either<RepositoryError, null>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id found"));
      }
      const [existing] = await this.db.select().from(detalhamentosAuditoria).where(eq(detalhamentosAuditoria.id, id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("No detalhamento auditoria found"));
      }
      // soft delete: set deletedAt instead of removing the row — needs the schema column added above
      await this.db.update(detalhamentosAuditoria).set({ deletedAt: new Date() }).where(eq(detalhamentosAuditoria.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("Repository error"));
    }
  }

  async deleteDetalhamentoAuditoria(id: string): Promise<Either<RepositoryError, null>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id found"));
      }
      const [existing] = await this.db.select().from(detalhamentosAuditoria).where(eq(detalhamentosAuditoria.id, id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("No detalhamento auditoria found"));
      }
      await this.db.delete(detalhamentosAuditoria).where(eq(detalhamentosAuditoria.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("Repository error"));
    }
  }
}

export default DetalhamentoAuditoriaRepository;
