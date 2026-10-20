import { ZodTypeAny } from "zod";
import { ICategoriaValidator } from "../interfaces/category_interfaces/categoria_validatoria.validator";
import {
   CreateCategoriaSchema,
   UpdateCategoriaSchema,
} from "../utils/schemas/categoria.schema";
import categoriasNomesEnum from "../enums/categorias_nomes.enum";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import BaseValidator from "./base.validator";

class CategoriaValidator extends BaseValidator implements ICategoriaValidator {
   constructor() {
      super();
   }
   validateCreatePayload(payload: unknown): Either<ValidationError, void> {
      return this.validateWith(CreateCategoriaSchema, payload);
   }
   validateUpdatePayload(payload: unknown): Either<ValidationError, void> {
      return this.validateWith(UpdateCategoriaSchema, payload);
   }
   validateNome(payload: string): Either<ValidationError, void> {
      return this.validateWith(categoriasNomesEnum, payload);
   }

   private validateWith(schema: ZodTypeAny, payload: unknown): Either<ValidationError, void> {
      const result = schema.safeParse(payload);
      if (!result.success) {
         return left(
            new ValidationError(
               "400",
               result.error.errors.map((err) => err.message).join(", "),
            ),
         );
      }
      return right(undefined);
   }
}

export default CategoriaValidator;
