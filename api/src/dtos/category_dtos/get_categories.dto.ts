import { CategoriaResponseDto } from "./categoria_response.dto";
import { BaseMessageGet, BaseMessageGetOne } from "../global_get.dto";

type ResponseGetCategoriesDto = BaseMessageGet<CategoriaResponseDto>;

type ResponseFindCategoryByIdDto = BaseMessageGetOne<CategoriaResponseDto>;

export { ResponseFindCategoryByIdDto, ResponseGetCategoriesDto };