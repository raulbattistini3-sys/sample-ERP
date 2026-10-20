import { NewProductEntity, ProductEntity, ProductWithCategoria } from "../../entities/product.entity";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { RepositoryError } from "../../globals/errors/global_repository_error.error";

interface IProductRepository {
   // includeInactive: ADM/SU see deactivated products; everyone else gets 404 / only active ones
   getProductById(id: string, includeInactive?: boolean): Promise<Either<BaseAppError, ProductWithCategoria>>;
   // products with their category, for the list, filter and download endpoints
   getProductsWithCategoria(includeInactive?: boolean): Promise<Either<RepositoryError, ProductWithCategoria[]>>;
   // categoria is resolved to categoriaId by the service before inserting
   createProduct(
      payload: NewProductEntity,
   ): Promise<Either<RepositoryError, ProductEntity>>;
   // categoria is resolved to categoriaId by the service; 404 when the product doesn't exist
   updateProduct(
      id: string,
      values: Partial<NewProductEntity>,
      includeInactive?: boolean,
   ): Promise<Either<BaseAppError, null>>;
   deactivateProduct(id: string): Promise<Either<RepositoryError, null>>;
   removeProduct(id: string): Promise<Either<RepositoryError, null>>;
}
export default IProductRepository;
