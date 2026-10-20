import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";
import { IBaseValidator } from "../general_interfaces/base_validator.interface";
import { CreateAuditoriaDto } from "../../dtos/auditoria_dtos/create_auditoria.dto";

export interface IAuditoriaValidator extends IBaseValidator {
   parseCreatePayload(payload: unknown): Either<BaseAppError, CreateAuditoriaDto>;
   validatePayload(payload: unknown): Either<BaseAppError, void>;
}
