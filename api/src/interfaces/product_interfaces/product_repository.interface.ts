import Categoria from "../../entities/categoria.entity";
import { NewProductEntity, ProductEntity } from "../../entities/product.entity";
import { Either } from "../../globals/errors/left_right_either.error";
import { RepositoryError } from "../../globals/errors/global_repository_error.error";

interface IProductRepository {
   getProductById(id: string): Promise<Either<RepositoryError, ProductEntity>>;
   getProducts(): Promise<Either<RepositoryError, ProductEntity[]>>;
   // categoria is resolved to categoriaId by the service before inserting
   createProduct(
      payload: NewProductEntity,
   ): Promise<Either<RepositoryError, ProductEntity>>;
   updateProduct(
      payload: Omit<ProductEntity, "categoria"> & {
         categoria: Pick<Categoria, "nome">;
      },
   ): Promise<Either<RepositoryError, null>>;
   deactivateProduct(id: string): Promise<Either<RepositoryError, null>>;
   removeProduct(id: string): Promise<Either<RepositoryError, null>>;
}
export default IProductRepository;
