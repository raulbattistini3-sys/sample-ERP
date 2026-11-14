import { z } from "zod";
import { Either } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { AlteracaoSchema, PlanoSchema } from "../utils/schemas/pagamento_recorrente.schema";
import BaseValidator from "./base.validator";

// Pagamento mensal: a new plan, and what may change on a running one. Rules that need the database
// or HubSpot (start not in the past, the client exists and has an e-mail) stay in the service.
class PagamentoRecorrenteValidator extends BaseValidator {
   parsePlano(payload: unknown): Either<ValidationError, z.infer<typeof PlanoSchema>> {
      return this.parseWith(PlanoSchema, payload);
   }

   parseAlteracao(payload: unknown): Either<ValidationError, z.infer<typeof AlteracaoSchema>> {
      return this.parseWith(AlteracaoSchema, payload);
   }
}

export default PagamentoRecorrenteValidator;
