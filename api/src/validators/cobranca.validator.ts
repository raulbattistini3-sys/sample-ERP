import { z } from "zod";
import { Either } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { CobrancaSchema } from "../utils/schemas/cobranca.schema";
import BaseValidator from "./base.validator";

// Cobranças: a one-time invoice for one or more clients
class CobrancaValidator extends BaseValidator {
   parseCobranca(payload: unknown): Either<ValidationError, z.infer<typeof CobrancaSchema>> {
      return this.parseWith(CobrancaSchema, payload);
   }
}

export default CobrancaValidator;
