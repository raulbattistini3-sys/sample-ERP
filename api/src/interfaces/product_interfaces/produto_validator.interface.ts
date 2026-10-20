import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import BaseValidator from "../../validators/base.validator";

export interface IProductValidator extends BaseValidator {
   validatePayload(payload: unknown): Either<BaseAppError, void>;
   validateCreatePayload(payload: unknown): Either<BaseAppError, void>;
}
