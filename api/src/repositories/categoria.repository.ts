import { eq } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { categorias } from "../db/schema/categoria.schema";
import { Categoria } from "../entities/categoria.entity";
import CategoryRepositoryInterface from "../interfaces/category_interfaces/categoria_repository.interface";
import { PayloadCreateCategoria, ResponseCreateCategoria } from "../dtos/category_dtos/create_categoria.dto";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
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
      return left(new RepositoryError("Database error"));
    }
  }

  async getCategoriaByName(nome: Categoria["nome"]): Promise<Either<RepositoryError, Categoria>> {
    try {
      const [categoria] = await this.db.select().from(categorias).where(eq(categorias.nome, nome)).limit(1);
      if (!categoria || !categoria.ativo) {
        return left(new RepositoryError("Categoria not found"));
      }
      return right(categoria);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async getCategorias(): Promise<Either<RepositoryError, Categoria[]>> {
    try {
      const categoriasData = await this.db.select().from(categorias);
      if (!categoriasData || categoriasData.length === 0) {
        return left(new RepositoryError("No categories found"));
      }
      return right(categoriasData);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async createCategoria(payload: PayloadCreateCategoria): Promise<Either<RepositoryError, ResponseCreateCategoria>> {
    try {
      const [categoria] = await this.db.insert(categorias).values(payload).returning();
      return right(categoria);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async updateCategoria(payload: Categoria): Promise<Either<RepositoryError, void>> {
    try {
      const [existing] = await this.db.select().from(categorias).where(eq(categorias.id, payload.id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("Categoria not found"));
      }
      await this.db.update(categorias).set(payload).where(eq(categorias.id, payload.id));
      return right(undefined);
    } catch (error) {
      return left(new RepositoryError("Database error"));
    }
  }

  async deactivateCategoria(id: string): Promise<Either<RepositoryError, void>> {
    try {
      const [existing] = await this.db.select().from(categorias).where(eq(categorias.id, id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("Categoria not found"));
      }
      await this.db.update(categorias).set({ ativo: false }).where(eq(categorias.id, id));
      return right(undefined);
    } catch (error) {
      return left(new RepositoryError("Database error"));
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
      return left(new RepositoryError("Database error"));
    }
  }
}

export default CategoriaRepository;
