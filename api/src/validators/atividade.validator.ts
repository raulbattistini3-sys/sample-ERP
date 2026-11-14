import { z } from "zod";
import { Either } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { AtividadeSchema, EstagioSchema } from "../utils/schemas/atividade.schema";
import BaseValidator from "./base.validator";

// Atividades (note, e-mail, meeting on the HubSpot timeline) and a company's Funil stage
class AtividadeValidator extends BaseValidator {
   parseAtividade(payload: unknown): Either<ValidationError, z.infer<typeof AtividadeSchema>> {
      return this.parseWith(AtividadeSchema, payload);
   }

   parseEstagio(payload: unknown): Either<ValidationError, z.infer<typeof EstagioSchema>> {
      return this.parseWith(EstagioSchema, payload);
   }
}

export default AtividadeValidator;
