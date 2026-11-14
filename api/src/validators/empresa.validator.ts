import { Either } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { EmpresaInput, EmpresaSchema } from "../utils/schemas/empresa.schema";
import BaseValidator from "./base.validator";

// Empresas: the company form, for both create and edit
class EmpresaValidator extends BaseValidator {
   parseEmpresa(payload: unknown): Either<ValidationError, EmpresaInput> {
      return this.parseWith(EmpresaSchema, payload);
   }
}

export default EmpresaValidator;
