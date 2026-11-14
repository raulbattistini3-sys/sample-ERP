import { z } from "zod";
import { Either } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { AcaoEmLoteSchema } from "../utils/schemas/produto_lote.schema";
import BaseValidator from "./base.validator";

// Products: one action on several selected products (ids deduplicated and lower-cased by the schema)
class ProdutoLoteValidator extends BaseValidator {
   parseAcao(payload: unknown): Either<ValidationError, z.infer<typeof AcaoEmLoteSchema>> {
      return this.parseWith(AcaoEmLoteSchema, payload);
   }
}

export default ProdutoLoteValidator;
