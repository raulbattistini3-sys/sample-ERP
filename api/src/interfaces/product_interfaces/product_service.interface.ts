// aquilo que esta chamado de "ProductRepositoryInterface" pertence aqui
// o ProductRepositoryInterface de fato seria apenas o acesso ao banco de dados
// rever os DTOs e nomenclaturas para desacoplar regra de negócio de implementação
import {
   CreateProductDto,
   ResponseCreateProductDto,
} from "../../dtos/product_dtos/create_product.dto";
import {
   ResponseGetProductDto,
   ResponseGetProductsDto,
   ResponseFindFilteredProductsDto,
   ResponseFindProductsToDownloadDto,
} from "../../dtos/product_dtos/get_products.dto";
import { PayloadUpdateProductDto } from "../../dtos/product_dtos/update_product.dto";
import { Either } from "../../globals/errors/left_right_either.error";
import { BaseAppError } from "../../errors/global_error.error";

interface IProductService {
   createProduct: (
      productDto: CreateProductDto,
   ) => Promise<Either<BaseAppError, ResponseCreateProductDto>>;
   // includeInactive: true for ADM/SU, who also see deactivated products
   getProducts: (
      page: number,
      amount: number,
      includeInactive?: boolean,
   ) => Promise<Either<BaseAppError, ResponseGetProductsDto>>;
   findProductById: (
      id: string,
      includeInactive?: boolean,
   ) => Promise<Either<BaseAppError, ResponseGetProductDto>>;
   // query is the raw req.query; the service validates and coerces it
   findProductsByFilter: (
      page: number,
      amount: number,
      query: unknown,
      includeInactive?: boolean,
   ) => Promise<Either<BaseAppError, ResponseFindFilteredProductsDto>>;
   findProductsToDownload: (
      page: number,
      amount: number,
      query: unknown,
      includeInactive?: boolean,
   ) => Promise<Either<BaseAppError, ResponseFindProductsToDownloadDto>>;
   updateProduct: (
      payload: PayloadUpdateProductDto,
      includeInactive?: boolean,
   ) => Promise<Either<BaseAppError, null>>;
   deleteProduct: (id: string) => Promise<Either<BaseAppError, null>>;
   deactivateProduct: (id: string) => Promise<Either<BaseAppError, null>>;
}

export default IProductService;
