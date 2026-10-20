import { ValidationError } from "../errors/client_errors/four_xx.error";
import { BaseAppError } from "../errors/global_error.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { IProductValidator } from "../interfaces/product_interfaces/produto_validator.interface";
import { ZodTypeAny } from "zod";
import ProdutoSchema, { CreateProdutoSchema } from "../utils/schemas/produto.schema";
import BaseValidator from "./base.validator";

class ProdutoValidator extends BaseValidator implements IProductValidator {
   constructor() {
      super();
   }
   validatePayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(ProdutoSchema, payload);
   }

   validateCreatePayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(CreateProdutoSchema, payload);
   }

   private validateWith(schema: ZodTypeAny, payload: unknown): Either<BaseAppError, void> {
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

export default ProdutoValidator;
