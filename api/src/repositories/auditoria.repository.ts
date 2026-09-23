import { eq, isNull } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { auditorias } from "../db/schema/auditoria.schema";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import IAuditoryRepository from "../interfaces/auditory_interfaces/auditoria_repository.interface";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { PayloadCreateAuditoria } from "../dtos/auditoria_dtos/create_auditoria.dto";
import { GetUserPreviousAudictionsDto } from "../dtos/auditoria_dtos/get_auditoria.dto";

class AuditoriaRepository implements IAuditoryRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getAuditorias(): Promise<Either<RepositoryError, AuditoriaEntity[]>> {
    try {
      const auditoriasData = await this.db.select().from(auditorias).where(isNull(auditorias.deletedAt));
      if (!auditoriasData || auditoriasData.length === 0) {
        return left(new RepositoryError("No auditorias found"));
      }
      return right(auditoriasData);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async getAuditoriaById(id: string): Promise<Either<RepositoryError, AuditoriaEntity>> {
    try {
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      return right(auditoria);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async createAuditoria(payload: PayloadCreateAuditoria): Promise<Either<RepositoryError, AuditoriaEntity>> {
    try {
      if (!payload) {
        return left(new RepositoryError("No payload found"));
      }
      const [auditoria] = await this.db.insert(auditorias).values(payload).returning();
      return right(auditoria);
    } catch (error) {
      return left(new RepositoryError("Database error"));
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
      return left(new RepositoryError("error message"));
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
        .where(eq(auditorias.nomeDoAuditorId, userId));
      if (!auditoriasData || auditoriasData.length === 0) {
        return left(new RepositoryError("No auditorias found"));
      }
      return right(auditoriasData);
    } catch (error) {
      return left(new RepositoryError("error message"));
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
      return left(new RepositoryError("error message"));
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
      return left(new RepositoryError("error message"));
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
      return left(new RepositoryError("error message"));
    }
  }
}

export default AuditoriaRepository;
