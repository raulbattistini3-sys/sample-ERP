import { Either } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ClienteInput, ClienteSchema, VinculoSchema } from "../utils/schemas/cliente.schema";
import BaseValidator from "./base.validator";

// Clientes: the create/edit form (one schema for both) and linking clients to a company
class ClienteValidator extends BaseValidator {
   parseCliente(payload: unknown): Either<ValidationError, ClienteInput> {
      return this.parseWith(ClienteSchema, payload);
   }

   parseVinculo(payload: unknown): Either<ValidationError, { clienteIds: string[] }> {
      return this.parseWith(VinculoSchema, payload);
   }
}

export default ClienteValidator;
