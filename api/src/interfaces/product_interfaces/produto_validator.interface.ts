import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import BaseValidator from "../../validators/base.validator";
import { ProductFilterDto } from "../../dtos/product_dtos/get_products.dto";

export interface IProductValidator extends BaseValidator {
   validateCreatePayload(payload: unknown): Either<BaseAppError, void>;
   validateUpdatePayload(payload: unknown): Either<BaseAppError, void>;
   parseFilterParams(query: unknown): Either<BaseAppError, ProductFilterDto>;
}
