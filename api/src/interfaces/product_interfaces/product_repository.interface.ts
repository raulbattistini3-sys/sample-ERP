import { NewProductEntity, ProductEntity, ProductWithCategoria } from "../../entities/product.entity";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { RepositoryError } from "../../globals/errors/global_repository_error.error";
import { ProductImportWrites } from "../../dtos/product_dtos/import_products.dto";
import { DrizzleDB } from "../../db/client";

interface IProductRepository {
   // includeInactive: ADM/SU see deactivated products; everyone else gets 404 / only active ones
   getProductById(id: string, includeInactive?: boolean): Promise<Either<BaseAppError, ProductWithCategoria>>;
   // products with their category, for the list, filter and download endpoints
   getProductsWithCategoria(includeInactive?: boolean): Promise<Either<RepositoryError, ProductWithCategoria[]>>;
   // categoria is resolved to categoriaId by the service before inserting; 409 when the SKU is taken
   createProduct(
      payload: NewProductEntity,
   ): Promise<Either<BaseAppError, ProductEntity>>;
   // categoria is resolved to categoriaId by the service; 404 when the product doesn't exist, 409 when the SKU is taken
   // usuarioId: who made the change; it's recorded as an "Alteracao" auditoria in the same transaction
   updateProduct(
      id: string,
      values: Partial<NewProductEntity>,
      usuarioId: string,
      includeInactive?: boolean,
   ): Promise<Either<BaseAppError, null>>;
   getProductsBySkus(skus: string[]): Promise<Either<RepositoryError, { id: string; sku: string }[]>>;
   // creates and updates of one spreadsheet import, in a single transaction; 409 when a SKU was taken meanwhile
   importProducts(
      writes: ProductImportWrites,
      usuarioId: string,
      afterWrites?: (tx: DrizzleDB) => Promise<void>,
   ): Promise<Either<BaseAppError, null>>;
   deactivateProduct(id: string, usuarioId: string): Promise<Either<BaseAppError, null>>;
   removeProduct(id: string): Promise<Either<RepositoryError, null>>;
}
export default IProductRepository;
