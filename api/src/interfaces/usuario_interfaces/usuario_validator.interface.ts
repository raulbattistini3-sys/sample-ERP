import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { IBaseValidator } from "../general_interfaces/base_validator.interface";

export interface IUsuarioValidator extends IBaseValidator {
   validateCreatePayload(payload: unknown): Either<BaseAppError, void>;
   validateUpdatePayload(payload: unknown): Either<BaseAppError, void>;
   validateRegisterPayload(payload: unknown): Either<BaseAppError, void>;
   validateLoginPayload(payload: unknown): Either<BaseAppError, void>;
   validateForgotPasswordPayload(payload: unknown): Either<BaseAppError, void>;
   validateResetPasswordPayload(payload: unknown): Either<BaseAppError, void>;
}
