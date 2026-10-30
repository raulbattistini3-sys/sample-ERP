import { ZodError } from "zod";
import { IAuditoriaValidator } from "../interfaces/auditory_interfaces/auditoria_validator.interface";
import {
   CreateAuditoriaManualSchema,
   CreateAuditoriaSchema,
   UpdateAuditoriaSchema,
} from "../utils/schemas/auditoria.schema";
import { CreateAuditoriaDto, CreateAuditoriaManualDto } from "../dtos/auditoria_dtos/create_auditoria.dto";
import { PayloadUpdateAuditoria } from "../dtos/auditoria_dtos/update_auditoria.dto";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import BaseValidator from "./base.validator";

class AuditoriaValidator extends BaseValidator implements IAuditoriaValidator {
   constructor() {
      super();
   }
   // returns the parsed payload: dates and decimals are coerced, defaults applied
   parseCreatePayload(payload: unknown): Either<BaseAppError, CreateAuditoriaDto> {
      const result = CreateAuditoriaSchema.safeParse(payload);
      if (!result.success) {
         return left(this.toValidationError(result.error));
      }
      return right(result.data);
   }

   parseCreateManualPayload(payload: unknown): Either<BaseAppError, CreateAuditoriaManualDto> {
      const result = CreateAuditoriaManualSchema.safeParse(payload);
      if (!result.success) {
         return left(this.toValidationError(result.error));
      }
      return right(result.data);
   }

   parseUpdatePayload(payload: unknown): Either<BaseAppError, PayloadUpdateAuditoria> {
      const result = UpdateAuditoriaSchema.safeParse(payload);
      if (!result.success) {
         return left(this.toValidationError(result.error));
      }
      return right(result.data);
   }

   private toValidationError(error: ZodError) {
      return new ValidationError(
         "400",
         error.errors.map((err) => err.message).join(", "),
      );
   }
}

export default AuditoriaValidator;
