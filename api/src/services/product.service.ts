import { ProductEntity } from "../entities/product.entity";
import CategoriaRepository from "../repositories/categoria.repository";
import ProductRepository from "../repositories/product.repository";
import IProductService from "../interfaces/product_interfaces/product_service.interface";
import {
   CreateProductDto,
   ResponseCreateProductDto,
} from "../dtos/product_dtos/create_product.dto";
import {
   ResponseGetProductDto,
   ResponseGetProductsDto,
   FindFilteredProductsPayloadDto,
   ResponseFindFilteredProductsDto,
   ResponseFindProductsToDownloadDto,
} from "../dtos/product_dtos/get_products.dto";
import { PayloadUpdateProductDto } from "../dtos/product_dtos/update_product.dto";
import { generateUUID } from "../utils/helpers/generate_uuid.util";
import NOW from "../globals/helpers/global_time_constants.util";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import ProdutoValidator from "../validators/produto.validator";
import CategoriaValidator from "../validators/categoria.validator";
import paginate from "../utils/helpers/paginate_data.helper";
import filterUniqueProperty from "../utils/helpers/filter_unique_elements.helper";
import filterProducts from "../utils/helpers/filter_products_params.helper";
import IProductRepository from "../interfaces/product_interfaces/product_repository.interface";
import ICategoriaRepository from "../interfaces/category_interfaces/categoria_repository.interface";
import { IProductValidator } from "../interfaces/product_interfaces/produto_validator.interface";
import { ICategoriaValidator } from "../interfaces/category_interfaces/categoria_validatoria.validator";

class ProductService implements IProductService {
   constructor(
      private productRepository: IProductRepository,
      private categoriaRepository: ICategoriaRepository,
      private productValidator: IProductValidator,
      private categoriaValidator: ICategoriaValidator,
   ) {}

   async createProduct(
      productPayload: CreateProductDto,
   ): Promise<Either<BaseAppError, ResponseCreateProductDto>> {
      try {
         const validation =
            this.productValidator.validatePayload(productPayload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoriaValidation = this.categoriaValidator.validateNome(
            productPayload.categoria.nome,
         );
         if (categoriaValidation.isLeft()) {
            return left(categoriaValidation.value);
         }

         productPayload.data_de_cadastro =
            productPayload.data_de_cadastro ?? NOW;

         const productData = await this.productRepository.createProduct({
            id: generateUUID(),
            ativo: true,
            ...productPayload,
         });
         const categoriaData =
            await this.categoriaRepository.getCategoriaByName(
               productPayload.categoria.nome,
            );
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               return left(productData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         } else {
            let data: ResponseCreateProductDto = productData.value;
            if (categoriaData.isLeft()) {
               if (categoriaData.value instanceof ValidationError) {
                  return left(categoriaData.value);
               }
               return left(
                  new ServerError("500", true, "internal server errror"),
               );
            }
            data.categoria = categoriaData.value;

            return right(data);
         }
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }

   async getProducts(
      page: number,
      amount: number,
   ): Promise<Either<BaseAppError, ResponseGetProductsDto>> {
      try {
         const validation = this.productValidator.validatePageAndAmount(
            page,
            amount,
         );
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const productData = await this.productRepository.getProducts();
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               // TODO: fix it will never fall in this condition, only in RepositoryError
               return left(productData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         const paginatedResult = paginate(productData.value, page, amount);
         const response: ResponseGetProductsDto = {
            data: paginatedResult.data,
            pageNumber: paginatedResult.currentPage,
            pageSize: paginatedResult.perPage,
            totalItems: productData.value.length,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }

   async findProductById(
      id: string,
   ): Promise<Either<BaseAppError, ResponseGetProductDto>> {
      try {
         const validation = this.productValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const productData = await this.productRepository.getProductById(id);
         if (productData.isLeft()) {
            return left(productData.value);
         }
         const response: ResponseGetProductDto = {
            data: productData.value,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async findProductsByFilter(
      amount: number,
      includeParams: FindFilteredProductsPayloadDto,
   ): Promise<Either<BaseAppError, ResponseFindFilteredProductsDto>> {
      try {
         const validation =
            this.productValidator.validatePayload(includeParams);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const productData = await this.productRepository.getProducts();
         if (productData.isLeft()) {
            return left(productData.value);
         } else if (!productData.value) {
            return left(
               new ValidationError("404", "Produto(s) não encontrado(s)"),
            );
         }
         let filteredProducts = filterProducts(
            productData.value,
            includeParams,
         );
         if (filteredProducts.isLeft()) {
            return left(filteredProducts.value);
         }
         const filteredProductsLength = filteredProducts.value.data.length;
         if (filteredProductsLength === 0) {
            return left(new ValidationError("404", "Produto não encontrado"));
         }
         if (filteredProductsLength > amount) {
            filteredProducts.value.data = filteredProducts.value.data.slice(
               0,
               amount,
            );
            filteredProducts.value.pageSize = amount;
            filteredProducts.value.totalItems = amount;
         }

         return right(filteredProducts.value);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async findProductsToDownload(
      amount: number,
      page: number,
      includeParamsPayload: FindFilteredProductsPayloadDto,
   ): Promise<
      Either<BaseAppError, ResponseFindProductsToDownloadDto<ProductEntity>>
   > {
      try {
         const payloadValidation =
            this.productValidator.validatePayload(includeParamsPayload);
         if (payloadValidation.isLeft()) {
            return left(payloadValidation.value);
         }
         const paginateValidation = this.productValidator.validatePageAndAmount(
            page,
            amount,
         );
         if (paginateValidation.isLeft()) {
            return left(paginateValidation.value);
         }
         const productData = await this.productRepository.getProducts();
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               return left(productData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         let paginatedResult = paginate(productData.value, page, amount);
         let categoriasUnicas = filterUniqueProperty(
            productData.value,
            "categoria",
         );
         const aggregatedValueCategoria = new Map<
            (typeof categoriasUnicas)[0],
            number
         >();
         for (const categoria of categoriasUnicas) {
            let valor = 0;
            for (const product of productData.value) {
               if (product.categoria === categoria) {
                  valor += product.valor_de_venda;
               }
            }
            aggregatedValueCategoria.set(categoria, valor);
         }

         const response: ResponseFindProductsToDownloadDto<ProductEntity> = {
            data: paginatedResult.data,
            pageNumber: paginatedResult.currentPage,
            pageSize: paginatedResult.perPage,
            totalItems: productData.value.length,
            aggregated_value: aggregatedValueCategoria,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }

   async updateProduct(
      product: PayloadUpdateProductDto,
   ): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.productValidator.validatePayload(product);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoriaValidation = this.categoriaValidator.validateNome(
            product.categoria.nome,
         );
         if (categoriaValidation.isLeft()) {
            return left(categoriaValidation.value);
         }
         const productData =
            await this.productRepository.updateProduct(product);
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               return left(productData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async deleteProduct(id: string): Promise<Either<BaseAppError, null>> {
      try {
         const productData = await this.productRepository.removeProduct(id);
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               return left(productData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async deactivateProduct(id: string): Promise<Either<BaseAppError, null>> {
      try {
         const productData = await this.productRepository.deactivateProduct(id);
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               return left(productData.value);
            }
            return left(new ServerError("500", true, "internal server error"));
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
}

export default ProductService;
