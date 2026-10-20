import { asc, eq } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { produtos } from "../db/schema/product.schema";
import { categorias } from "../db/schema/categoria.schema";
import { NewProductEntity, ProductEntity, ProductWithCategoria } from "../entities/product.entity";
import IProductRepository from "../interfaces/product_interfaces/product_repository.interface";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";

class ProductRepository implements IProductRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getProductById(id: string): Promise<Either<BaseAppError, ProductWithCategoria>> {
    try {
      const [productData] = await this.db
        .select({ produto: produtos, categoria: categorias })
        .from(produtos)
        .innerJoin(categorias, eq(produtos.categoriaId, categorias.id))
        .where(eq(produtos.id, id))
        .limit(1);
      if (!productData || !productData.produto.ativo) {
        return left(new ValidationError("404", "Produto não encontrado"));
      }
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  async getProductsWithCategoria(): Promise<Either<RepositoryError, ProductWithCategoria[]>> {
    try {
      const productData = await this.db
        .select({ produto: produtos, categoria: categorias })
        .from(produtos)
        .innerJoin(categorias, eq(produtos.categoriaId, categorias.id))
        .where(eq(produtos.ativo, true))
        .orderBy(asc(produtos.name));
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async getProducts(): Promise<Either<RepositoryError, ProductEntity[]>> {
    try {
      const productData = await this.db.select().from(produtos).where(eq(produtos.ativo, true));
      if (!productData) {
        return left(new RepositoryError("404"));
      }
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  async createProduct(payload: NewProductEntity): Promise<Either<RepositoryError, ProductEntity>> {
    try {
      const [productData] = await this.db.insert(produtos).values(payload).returning();
      if (!productData) {
        return left(new RepositoryError("Produto não foi criado"));
      }
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  async updateProduct(
    payload: Omit<ProductEntity, "categoriaId"> & { categoria: { nome: string } },
  ): Promise<Either<RepositoryError, null>> {
    try {
      const { id, categoria, ...rest } = payload;
      const [productData] = await this.db.select().from(produtos).where(eq(produtos.id, id)).limit(1);
      if (!productData) {
        return left(new RepositoryError("404"));
      }
      const [categoriaData] = await this.db
        .select()
        .from(categorias)
        .where(eq(categorias.nome, categoria.nome))
        .limit(1);
      if (!categoriaData) {
        return left(new RepositoryError("404"));
      }
      await this.db.update(produtos).set({ ...rest, categoriaId: categoriaData.id }).where(eq(produtos.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  async deactivateProduct(id: string): Promise<Either<RepositoryError, null>> {
    try {
      const [productData] = await this.db.select().from(produtos).where(eq(produtos.id, id)).limit(1);
      if (!productData) {
        return left(new RepositoryError("404"));
      }
      await this.db.update(produtos).set({ ativo: false }).where(eq(produtos.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  async removeProduct(id: string): Promise<Either<RepositoryError, null>> {
    try {
      const [productData] = await this.db.select().from(produtos).where(eq(produtos.id, id)).limit(1);
      if (!productData) {
        return left(new RepositoryError("404"));
      }
      await this.db.delete(produtos).where(eq(produtos.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }
}

export default ProductRepository;
