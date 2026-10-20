import { NewProductEntity, ProductEntity, ProductWithCategoria } from "../../entities/product.entity";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { RepositoryError } from "../../globals/errors/global_repository_error.error";

interface IProductRepository {
   getProductById(id: string): Promise<Either<BaseAppError, ProductWithCategoria>>;
   // active products with their category, for the list, filter and download endpoints
   getProductsWithCategoria(): Promise<Either<RepositoryError, ProductWithCategoria[]>>;
   // categoria is resolved to categoriaId by the service before inserting
   createProduct(
      payload: NewProductEntity,
   ): Promise<Either<RepositoryError, ProductEntity>>;
   // categoria is resolved to categoriaId by the service; 404 when the product doesn't exist
   updateProduct(
      id: string,
      values: Partial<NewProductEntity>,
   ): Promise<Either<BaseAppError, null>>;
   deactivateProduct(id: string): Promise<Either<RepositoryError, null>>;
   removeProduct(id: string): Promise<Either<RepositoryError, null>>;
}
export default IProductRepository;
