import { ValidationError } from "../../errors/client_errors/four_xx.error";
import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { IBaseValidator } from "../general_interfaces/base_validator.interface";

export interface ICategoriaValidator extends IBaseValidator {
   validateCreatePayload(payload: unknown): Either<BaseAppError, void>;
   validateUpdatePayload(payload: unknown): Either<BaseAppError, void>;
   validateNome(payload: string): Either<ValidationError, void>;
}
