import {
   PayloadCreateCategoria,
   ResponseCreateCategoria,
} from "../../dtos/category_dtos/create_categoria.dto";
import { ResponseArchiveCategory } from "../../dtos/category_dtos/delete_category.dto";
import {
   ResponseFindCategoryByIdDto,
   ResponseGetCategoriesDto,
} from "../../dtos/category_dtos/get_categories.dto";
import { PayloadUpdateCategory } from "../../dtos/category_dtos/update_category.dto";
import Categoria from "../../entities/categoria.entity";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

interface ICategoryService {
   getCategories: (
      page: number,
      amount: number,
   ) => Promise<Either<BaseAppError, ResponseGetCategoriesDto>>;
   findCategoryById: (
      id: string,
   ) => Promise<Either<BaseAppError, ResponseFindCategoryByIdDto>>;
   findCategoryByName: (
      name: Categoria["nome"],
   ) => Promise<Either<BaseAppError, ResponseFindCategoryByIdDto>>;
   createCategoria: (
      payload: PayloadCreateCategoria,
   ) => Promise<Either<BaseAppError, ResponseCreateCategoria>>;
   // TODO: is null better than undefined? in order to clean up memory allocation
   // usuarioId: who made the change; recorded as an "Alteracao" auditoria unless a manual one covers it
   updateCategory: (
      payload: PayloadUpdateCategory,
      usuarioId: string,
   ) => Promise<Either<BaseAppError, null>>;
   deleteCategory: (id: string) => Promise<Either<BaseAppError, null>>;
   archiveCategory: (id: string, usuarioId: string) => Promise<Either<BaseAppError, null>>;
}

export { ICategoryService };
