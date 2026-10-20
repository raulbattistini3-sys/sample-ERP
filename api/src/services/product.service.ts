import { ProductWithCategoria } from "../entities/product.entity";
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
   ResponseFindFilteredProductsDto,
   ResponseFindProductsToDownloadDto,
} from "../dtos/product_dtos/get_products.dto";
import { PayloadUpdateProductDto } from "../dtos/product_dtos/update_product.dto";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import ProdutoValidator from "../validators/produto.validator";
import CategoriaValidator from "../validators/categoria.validator";
import paginate from "../utils/helpers/paginate_data.helper";
import {
   toNewProductEntity,
   toProductResponse,
   toProductResponseFromRow,
   toProductUpdateEntity,
} from "../mappers/product.mapper";
import filterProducts from "../utils/helpers/filter_products_params.helper";
import IProductRepository from "../interfaces/product_interfaces/product_repository.interface";
import {
   ImportProductsResultDto,
   ImportRowErrorDto,
   ProductImportWrites,
} from "../dtos/product_dtos/import_products.dto";
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
            this.productValidator.validateCreatePayload(productPayload);
         if (validation.isLeft()) {
            return left(validation.value);
         }

         // 404 when the category doesn't exist or is inactive
         const categoriaData = await this.categoriaRepository.getCategoriaByName(
            productPayload.categoria.nome,
         );
         if (categoriaData.isLeft()) {
            return left(categoriaData.value);
         }
         const categoria = categoriaData.value;

         const productData = await this.productRepository.createProduct(
            toNewProductEntity(productPayload, categoria.id, new Date()),
         );
         if (productData.isLeft()) {
            return left(
               new ServerError("500", true, "internal server error", productData.value),
            );
         }

         return right(toProductResponse(productData.value, categoria));
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
      includeInactive = false,
   ): Promise<Either<BaseAppError, ResponseGetProductsDto>> {
      try {
         const validation = this.productValidator.validatePageAndAmount(
            page,
            amount,
         );
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const productData =
            await this.productRepository.getProductsWithCategoria(includeInactive);
         if (productData.isLeft()) {
            return left(
               new ServerError("500", true, "internal server error", productData.value),
            );
         }
         const paginatedResult = paginate(productData.value, page, amount);
         const response: ResponseGetProductsDto = {
            data: paginatedResult.data.map(toProductResponseFromRow),
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
      includeInactive = false,
   ): Promise<Either<BaseAppError, ResponseGetProductDto>> {
      try {
         const validation = this.productValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const productData = await this.productRepository.getProductById(id, includeInactive);
         if (productData.isLeft()) {
            return left(productData.value);
         }
         const response: ResponseGetProductDto = {
            data: toProductResponseFromRow(productData.value),
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
      page: number,
      amount: number,
      query: unknown,
      includeInactive = false,
   ): Promise<Either<BaseAppError, ResponseFindFilteredProductsDto>> {
      try {
         const filtered = await this.getFilteredProducts(page, amount, query, includeInactive);
         if (filtered.isLeft()) {
            return left(filtered.value);
         }
         const paginatedResult = paginate(filtered.value, page, amount);
         const response: ResponseFindFilteredProductsDto = {
            data: paginatedResult.data.map(toProductResponseFromRow),
            pageNumber: paginatedResult.currentPage,
            pageSize: paginatedResult.perPage,
            totalItems: filtered.value.length,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async findProductsToDownload(
      page: number,
      amount: number,
      query: unknown,
      includeInactive = false,
   ): Promise<Either<BaseAppError, ResponseFindProductsToDownloadDto>> {
      try {
         const filtered = await this.getFilteredProducts(page, amount, query, includeInactive);
         if (filtered.isLeft()) {
            return left(filtered.value);
         }
         // totals cover every filtered product, not only the requested page
         const aggregatedValue: Record<string, number> = {};
         for (const { produto, categoria } of filtered.value) {
            aggregatedValue[categoria.nome] =
               (aggregatedValue[categoria.nome] ?? 0) + Number(produto.valorDeVenda);
         }

         const paginatedResult = paginate(filtered.value, page, amount);
         const response: ResponseFindProductsToDownloadDto = {
            data: paginatedResult.data.map(toProductResponseFromRow),
            pageNumber: paginatedResult.currentPage,
            pageSize: paginatedResult.perPage,
            totalItems: filtered.value.length,
            aggregated_value: aggregatedValue,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }

   // shared by filter and download: validates paging and filters, then filters the active products
   private async getFilteredProducts(
      page: number,
      amount: number,
      query: unknown,
      includeInactive = false,
   ): Promise<Either<BaseAppError, ProductWithCategoria[]>> {
      const paginateValidation = this.productValidator.validatePageAndAmount(
         page,
         amount,
      );
      if (paginateValidation.isLeft()) {
         return left(paginateValidation.value);
      }
      const filters = this.productValidator.parseFilterParams(query);
      if (filters.isLeft()) {
         return left(filters.value);
      }
      const productData = await this.productRepository.getProductsWithCategoria(includeInactive);
      if (productData.isLeft()) {
         return left(
            new ServerError("500", true, "internal server error", productData.value),
         );
      }
      return right(filterProducts(productData.value, filters.value));
   }

   // includeInactive (ADM/SU): may edit and reactivate deactivated products; for anyone else
   // an inactive product is a 404 and `ativo` in the body is ignored
   async updateProduct(
      product: PayloadUpdateProductDto,
      includeInactive = false,
   ): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.productValidator.validateUpdatePayload(product);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         // 404 when the category doesn't exist or is inactive
         const categoriaData = await this.categoriaRepository.getCategoriaByName(
            product.categoria.nome,
         );
         if (categoriaData.isLeft()) {
            return left(categoriaData.value);
         }
         const productData = await this.productRepository.updateProduct(
            product.id,
            toProductUpdateEntity(
               includeInactive ? product : { ...product, ativo: undefined },
               categoriaData.value.id,
            ),
            includeInactive,
         );
         if (productData.isLeft()) {
            if (productData.value instanceof ValidationError) {
               return left(productData.value);
            }
            return left(
               new ServerError("500", true, "internal server error", productData.value),
            );
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   // Spreadsheet import (ADM/SU). Rows were read in column order by the web; here every row is
   // validated again, SKUs decide create vs update (an update also reactivates the product),
   // and nothing is written unless every row is valid.
   async importProducts(
      payload: unknown,
   ): Promise<Either<BaseAppError, ImportProductsResultDto>> {
      try {
         const envelope = this.productValidator.validateImportPayload(payload);
         if (envelope.isLeft()) {
            return left(envelope.value);
         }
         const rows = (payload as { rows: ({ linha: number } & Record<string, unknown>)[] }).rows;

         const errors = new Map<number, string[]>();
         const addError = (linha: number, message: string) =>
            errors.set(linha, [...(errors.get(linha) ?? []), message]);

         const parsed: { linha: number; dto: CreateProductDto }[] = [];
         const firstLineBySku = new Map<string, number>();
         for (const row of rows) {
            const result = this.productValidator.parseImportRow(row);
            if (result.isLeft()) {
               result.value.forEach((message) => addError(row.linha, message));
               continue;
            }
            const sku = result.value.sku;
            const firstLine = firstLineBySku.get(sku);
            if (firstLine !== undefined) {
               addError(row.linha, `SKU ${sku} repetido (já está na linha ${firstLine})`);
               continue;
            }
            firstLineBySku.set(sku, row.linha);
            parsed.push({ linha: row.linha, dto: result.value });
         }

         const categoriasData = await this.categoriaRepository.getCategorias();
         if (categoriasData.isLeft()) {
            return left(new ServerError("500", true, "internal server error", categoriasData.value));
         }
         const categoriaIds = new Map(
            categoriasData.value.filter((c) => c.ativo).map((c) => [c.nome, c.id]),
         );

         const existingData = await this.productRepository.getProductsBySkus([...firstLineBySku.keys()]);
         if (existingData.isLeft()) {
            return left(new ServerError("500", true, "internal server error", existingData.value));
         }
         const existingBySku = new Map<string, string[]>();
         for (const { id, sku } of existingData.value) {
            existingBySku.set(sku, [...(existingBySku.get(sku) ?? []), id]);
         }

         const writes: ProductImportWrites = { creates: [], updates: [] };
         const now = new Date();
         for (const { linha, dto } of parsed) {
            const categoriaId = categoriaIds.get(dto.categoria.nome);
            if (!categoriaId) {
               addError(linha, `Categoria "${dto.categoria.nome}" não encontrada ou inativa`);
               continue;
            }
            const existingIds = existingBySku.get(dto.sku) ?? [];
            if (existingIds.length > 1) {
               addError(linha, `SKU ${dto.sku} já existe em ${existingIds.length} produtos; não dá para saber qual atualizar`);
            } else if (existingIds.length === 1) {
               writes.updates.push({
                  id: existingIds[0],
                  values: toProductUpdateEntity({ ...dto, id: existingIds[0], ativo: true }, categoriaId),
               });
            } else {
               writes.creates.push(toNewProductEntity(dto, categoriaId, now));
            }
         }

         if (errors.size > 0) {
            const report: ImportRowErrorDto[] = [...errors.entries()]
               .sort(([a], [b]) => a - b)
               .map(([linha, mensagens]) => ({ linha, mensagens }));
            return right({ created: 0, updated: 0, errors: report });
         }

         const saved = await this.productRepository.importProducts(writes);
         if (saved.isLeft()) {
            return left(new ServerError("500", true, "internal server error", saved.value));
         }
         return right({ created: writes.creates.length, updated: writes.updates.length, errors: [] });
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
