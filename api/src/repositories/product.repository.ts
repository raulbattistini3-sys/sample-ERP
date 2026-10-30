import { asc, eq, inArray } from "drizzle-orm";
import { applyChanges, diffProduct, recordProductChange } from "./audit_trail.repository";
import { DrizzleDB } from "../db/client";
import { produtos } from "../db/schema/product.schema";
import { categorias } from "../db/schema/categoria.schema";
import { NewProductEntity, ProductEntity, ProductWithCategoria } from "../entities/product.entity";
import IProductRepository from "../interfaces/product_interfaces/product_repository.interface";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ProductImportWrites } from "../dtos/product_dtos/import_products.dto";
import { pgErrorCode } from "../utils/helpers/pg_error.util";

// ids are generated, so the only unique constraint a write on produtos can break is produtos_sku_key
const UNIQUE_VIOLATION = "23505";

const skuTaken = (error: unknown, message: string): ValidationError | null =>
  pgErrorCode(error) === UNIQUE_VIOLATION ? new ValidationError("409", message, error) : null;

class ProductRepository implements IProductRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getProductById(id: string, includeInactive = false): Promise<Either<BaseAppError, ProductWithCategoria>> {
    try {
      const [productData] = await this.db
        .select({ produto: produtos, categoria: categorias })
        .from(produtos)
        .innerJoin(categorias, eq(produtos.categoriaId, categorias.id))
        .where(eq(produtos.id, id))
        .limit(1);
      if (!productData || (!includeInactive && !productData.produto.ativo)) {
        return left(new ValidationError("404", "Produto não encontrado"));
      }
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  async getProductsWithCategoria(includeInactive = false): Promise<Either<RepositoryError, ProductWithCategoria[]>> {
    try {
      const productData = await this.db
        .select({ produto: produtos, categoria: categorias })
        .from(produtos)
        .innerJoin(categorias, eq(produtos.categoriaId, categorias.id))
        .where(includeInactive ? undefined : eq(produtos.ativo, true))
        .orderBy(asc(produtos.name));
      return right(productData);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  // products (active or not) whose SKU is in skus, to decide create vs update on import
  async getProductsBySkus(skus: string[]): Promise<Either<RepositoryError, { id: string; sku: string }[]>> {
    try {
      if (skus.length === 0) return right([]);
      const rows = await this.db
        .select({ id: produtos.id, sku: produtos.sku })
        .from(produtos)
        .where(inArray(produtos.sku, skus));
      return right(rows);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  // all writes of one import in a single transaction: every row is saved, or none
  async importProducts({ creates, updates }: ProductImportWrites, usuarioId: string): Promise<Either<BaseAppError, null>> {
    try {
      await this.db.transaction(async (tx: DrizzleDB) => {
        if (creates.length > 0) {
          await tx.insert(produtos).values(creates);
        }
        const categoriaNomes = await this.categoriaNomes(tx);
        for (const { id, values } of updates) {
          await this.updateAudited(tx, id, values, usuarioId, categoriaNomes);
        }
      });
      return right(null);
    } catch (error) {
      // another import or a create took one of these SKUs after the service checked them
      const conflict = skuTaken(error, "Um dos SKUs da planilha foi cadastrado enquanto ela era importada; importe de novo");
      return left(conflict ?? new RepositoryError("Database error", error));
    }
  }

  async createProduct(payload: NewProductEntity): Promise<Either<BaseAppError, ProductEntity>> {
    try {
      const [productData] = await this.db.insert(produtos).values(payload).returning();
      if (!productData) {
        return left(new RepositoryError("Produto não foi criado"));
      }
      return right(productData);
    } catch (error) {
      return left(skuTaken(error, `Já existe um produto com o SKU ${payload.sku}`) ?? new RepositoryError("500", error));
    }
  }

  async updateProduct(
    id: string,
    values: Partial<NewProductEntity>,
    usuarioId: string,
    includeInactive = false,
  ): Promise<Either<BaseAppError, null>> {
    try {
      const found = await this.db.transaction((tx: DrizzleDB) =>
        this.updateAudited(tx, id, values, usuarioId, null, includeInactive),
      );
      return found ? right(null) : left(new ValidationError("404", "Produto não encontrado"));
    } catch (error) {
      return left(skuTaken(error, `Já existe um produto com o SKU ${values.sku}`) ?? new RepositoryError("500", error));
    }
  }

  async deactivateProduct(id: string, usuarioId: string): Promise<Either<BaseAppError, null>> {
    try {
      const found = await this.db.transaction((tx: DrizzleDB) =>
        this.updateAudited(tx, id, { ativo: false }, usuarioId, null),
      );
      return found ? right(null) : left(new ValidationError("404", "Produto não encontrado"));
    } catch (error) {
      return left(new RepositoryError("500", error));
    }
  }

  // Locks the product row, applies `values` and records the change in the same transaction: an
  // automatic "Alteracao" auditoria, unless a manual one already covers it (see audit_trail.repository).
  // Nothing is recorded when no field actually changed. false = no such product (or inactive and
  // includeInactive is off).
  private async updateAudited(
    tx: DrizzleDB,
    id: string,
    values: Partial<NewProductEntity>,
    usuarioId: string,
    categoriaNomes: Map<string, string> | null,
    includeInactive = true,
  ): Promise<boolean> {
    const [before] = await tx.select().from(produtos).where(eq(produtos.id, id)).for("update");
    if (!before || (!includeInactive && !before.ativo)) {
      return false;
    }
    await tx.update(produtos).set(values).where(eq(produtos.id, id));
    const after = applyChanges(before, values as Partial<typeof before>);
    const nomes = categoriaNomes ?? (await this.categoriaNomes(tx));
    const snapshot = (p: typeof before) => ({ ...p, categoriaNome: nomes.get(p.categoriaId) ?? p.categoriaId });
    await recordProductChange(tx, {
      usuarioId,
      produtoId: id,
      nomeProduto: after.name,
      vendaAntes: Number(before.valorDeVenda),
      vendaDepois: Number(after.valorDeVenda),
      changes: diffProduct(snapshot(before), snapshot(after)),
    });
    return true;
  }

  private async categoriaNomes(tx: DrizzleDB): Promise<Map<string, string>> {
    const rows = await tx.select({ id: categorias.id, nome: categorias.nome }).from(categorias);
    return new Map(rows.map((c: { id: string; nome: string }) => [c.id, c.nome]));
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
