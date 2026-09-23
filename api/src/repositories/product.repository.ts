import { eq } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { produtos } from "../db/schema/product.schema";
import { categorias } from "../db/schema/categoria.schema";
import { ProductEntity } from "../entities/product.entity";
import IProductRepository from "../interfaces/product_interfaces/product_repository.interface";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";

class ProductRepository implements IProductRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getProductById(id: string): Promise<Either<RepositoryError, ProductEntity>> {
    try {
      const [productData] = await this.db.select().from(produtos).where(eq(produtos.id, id)).limit(1);
      if (!productData || !productData.ativo) {
        return left(new RepositoryError("404"));
      }
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("500"));
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
      return left(new RepositoryError("500"));
    }
  }

  async createProduct(
    payload: Omit<ProductEntity, "id" | "categoriaId"> & { categoria: { nome: string } },
  ): Promise<Either<RepositoryError, ProductEntity>> {
    try {
      const { categoria, ...rest } = payload;
      const [categoriaData] = await this.db
        .select()
        .from(categorias)
        .where(eq(categorias.nome, categoria.nome))
        .limit(1);
      if (!categoriaData) {
        return left(new RepositoryError("404"));
      }
      const [productData] = await this.db
        .insert(produtos)
        .values({ ...rest, categoriaId: categoriaData.id })
        .returning();
      if (!productData) {
        return left(new RepositoryError("500"));
      }
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("500"));
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
      return left(new RepositoryError("500"));
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
      return left(new RepositoryError("500"));
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
      return left(new RepositoryError("500"));
    }
  }
}

export default ProductRepository;
