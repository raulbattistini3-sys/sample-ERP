import { asc, eq } from "drizzle-orm";
import { applyChanges, diffCategoria, recordCategoriaChange } from "./audit_trail.repository";
import { DrizzleDB } from "../db/client";
import { categorias } from "../db/schema/categoria.schema";
import { Categoria } from "../entities/categoria.entity";
import CategoryRepositoryInterface from "../interfaces/category_interfaces/categoria_repository.interface";
import { NewCategoria, ResponseCreateCategoria } from "../dtos/category_dtos/create_categoria.dto";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";

class CategoriaRepository implements CategoryRepositoryInterface {
  constructor(private readonly db: DrizzleDB) {}

  async getCategoriaById(id: string): Promise<Either<RepositoryError, Categoria>> {
    try {
      const [categoria] = await this.db.select().from(categorias).where(eq(categorias.id, id)).limit(1);
      if (!categoria || !categoria.ativo) {
        return left(new RepositoryError("Categoria not found"));
      }
      return right(categoria);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async getCategoriaByName(nome: Categoria["nome"]): Promise<Either<BaseAppError, Categoria>> {
    try {
      const [categoria] = await this.db.select().from(categorias).where(eq(categorias.nome, nome)).limit(1);
      if (!categoria || !categoria.ativo) {
        return left(new ValidationError("404", `Categoria "${nome}" não encontrada ou inativa`));
      }
      return right(categoria);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async getCategorias(): Promise<Either<RepositoryError, Categoria[]>> {
    try {
      const categoriasData = await this.db.select().from(categorias).orderBy(asc(categorias.nome));
      return right(categoriasData);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async createCategoria(payload: NewCategoria): Promise<Either<RepositoryError, ResponseCreateCategoria>> {
    try {
      const [categoria] = await this.db.insert(categorias).values(payload).returning();
      return right(categoria);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async updateCategoria(payload: Categoria, usuarioId: string): Promise<Either<BaseAppError, void>> {
    return this.updateAudited(payload.id, payload, usuarioId);
  }

  async deactivateCategoria(id: string, usuarioId: string): Promise<Either<BaseAppError, void>> {
    return this.updateAudited(id, { ativo: false }, usuarioId);
  }

  // Locks the row, applies `values` and records the change in the same transaction: an automatic
  // "Alteracao" auditoria, unless a manual one already covers it (see audit_trail.repository)
  private async updateAudited(
    id: string,
    values: Partial<Categoria>,
    usuarioId: string,
  ): Promise<Either<BaseAppError, void>> {
    try {
      const found = await this.db.transaction(async (tx: DrizzleDB) => {
        const [before] = await tx.select().from(categorias).where(eq(categorias.id, id)).for("update");
        if (!before) return false;
        await tx.update(categorias).set(values).where(eq(categorias.id, id));
        const after = applyChanges(before, values);
        await recordCategoriaChange(tx, {
          usuarioId,
          categoriaId: id,
          nomeAntes: before.nome,
          nomeDepois: after.nome,
          changes: diffCategoria(before, after),
        });
        return true;
      });
      return found ? right(undefined) : left(new ValidationError("404", "Categoria não encontrada"));
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async deleteCategoria(id: string): Promise<Either<RepositoryError, void>> {
    try {
      const [existing] = await this.db.select().from(categorias).where(eq(categorias.id, id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("Categoria not found"));
      }
      await this.db.delete(categorias).where(eq(categorias.id, id));
      return right(undefined);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }
}

export default CategoriaRepository;
