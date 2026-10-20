import Categoria from "../entities/categoria.entity";
import { ICategoryService } from "../interfaces/category_interfaces/categoria_service.interface";
import {
   ResponseFindCategoryByIdDto,
   ResponseGetCategoriesDto,
} from "../dtos/category_dtos/get_categories.dto";
import { BaseAppError } from "../errors/global_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import {
   PayloadCreateCategoria,
   ResponseCreateCategoria,
} from "../dtos/category_dtos/create_categoria.dto";
import { PayloadUpdateCategory } from "../dtos/category_dtos/update_category.dto";
import CategoriaRepository from "../repositories/categoria.repository";
import CategoriaValidator from "../validators/categoria.validator";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import paginate from "../utils/helpers/paginate_data.helper";
import { toCategoriaResponse } from "../mappers/categoria.mapper";

class CategoriaService implements ICategoryService {
   constructor(
      private categoriaRepository: CategoriaRepository,
      private categoriaValidator: CategoriaValidator,
   ) {}

   async getCategories(
      page: number,
      amount: number,
   ): Promise<Either<BaseAppError, ResponseGetCategoriesDto>> {
      try {
         const validation = this.categoriaValidator.validatePageAndAmount(
            page,
            amount,
         );
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categorias = await this.categoriaRepository.getCategorias();
         if (categorias.isLeft()) {
            return left(categorias.value);
         }

         const paginatedResult = paginate(categorias.value, page, amount);
         const response: ResponseGetCategoriesDto = {
            data: paginatedResult.data.map(toCategoriaResponse),
            pageSize: paginatedResult.perPage,
            pageNumber: paginatedResult.currentPage,
            totalItems: paginatedResult.totalItems,
         };
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }

   async findCategoryById(
      id: string,
   ): Promise<Either<BaseAppError, ResponseFindCategoryByIdDto>> {
      try {
         const validation = this.categoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoria = await this.categoriaRepository.getCategoriaById(id);
         if (categoria.isLeft()) {
            return left(categoria.value);
         }
         const response: ResponseFindCategoryByIdDto = {
            data: toCategoriaResponse(categoria.value),
         };

         return right(response);
      } catch (error) {
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async findCategoryByName(
      name: Categoria["nome"],
   ): Promise<Either<BaseAppError, ResponseFindCategoryByIdDto>> {
      try {
         const validation = this.categoriaValidator.validateNome(name);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoria =
            await this.categoriaRepository.getCategoriaByName(name);
         if (categoria.isLeft()) {
            return left(categoria.value);
         }
         const response: ResponseFindCategoryByIdDto = {
            data: toCategoriaResponse(categoria.value),
         };

         return right(response);
      } catch (error) {
         return left(new ServerError("500", true, "internal server error", error));
      }
   }

   async createCategoria(
      payload: PayloadCreateCategoria,
   ): Promise<Either<BaseAppError, ResponseCreateCategoria>> {
      try {
         const validation = this.categoriaValidator.validateCreatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoria = await this.categoriaRepository.createCategoria({
            nome: payload.nome,
            tipo: payload.tipo,
            ativo: payload.ativo ?? true,
         });
         if (categoria.isLeft()) {
            return left(categoria.value);
         }
         const response: ResponseCreateCategoria = toCategoriaResponse(categoria.value);
         return right(response);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async updateCategory(
      payload: PayloadUpdateCategory,
      usuarioId: string,
   ): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.categoriaValidator.validateUpdatePayload(payload);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoria =
            await this.categoriaRepository.updateCategoria(payload, usuarioId);
         if (categoria.isLeft()) {
            return left(categoria.value);
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async archiveCategory(id: string, usuarioId: string): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.categoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoria =
            await this.categoriaRepository.deactivateCategoria(id, usuarioId);
         if (categoria.isLeft()) {
            return left(categoria.value);
         }
         return right(null);
      } catch (error) {
         if (error instanceof ValidationError) {
            return left(error);
         }
         return left(new ServerError("500", true, "internal server error", error));
      }
   }
   async deleteCategory(id: string): Promise<Either<BaseAppError, null>> {
      try {
         const validation = this.categoriaValidator.validateUUIDv4(id);
         if (validation.isLeft()) {
            return left(validation.value);
         }
         const categoria = await this.categoriaRepository.deleteCategoria(id);
         if (categoria.isLeft()) {
            return left(categoria.value);
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

export { CategoriaService };
