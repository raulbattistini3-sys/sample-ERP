import { ValidationError } from "../errors/client_errors/four_xx.error";
import { BaseAppError } from "../errors/global_error.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { IProductValidator } from "../interfaces/product_interfaces/produto_validator.interface";
import { ZodError, ZodTypeAny } from "zod";
import {
   CreateProdutoSchema,
   FilterProdutoSchema,
   ImportProdutosSchema,
   UpdateProdutoSchema,
} from "../utils/schemas/produto.schema";
import { CreateProductDto } from "../dtos/product_dtos/create_product.dto";
import { ProductFilterDto } from "../dtos/product_dtos/get_products.dto";
import BaseValidator from "./base.validator";

class ProdutoValidator extends BaseValidator implements IProductValidator {
   constructor() {
      super();
   }
   validateCreatePayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(CreateProdutoSchema, payload);
   }

   validateUpdatePayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(UpdateProdutoSchema, payload);
   }

   // returns the parsed filters: query values arrive as strings and numbers are coerced
   parseFilterParams(query: unknown): Either<BaseAppError, ProductFilterDto> {
      const result = FilterProdutoSchema.safeParse(query);
      if (!result.success) {
         return left(this.toValidationError(result.error));
      }
      return right(result.data);
   }

   validateImportPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(ImportProdutosSchema, payload);
   }

   // one spreadsheet row: the parsed product, or every problem with it (not just the first)
   parseImportRow(row: unknown): Either<string[], CreateProductDto> {
      const result = CreateProdutoSchema.safeParse(row);
      if (!result.success) {
         return left(result.error.errors.map((err) => err.message));
      }
      return right(result.data);
   }

   private validateWith(schema: ZodTypeAny, payload: unknown): Either<BaseAppError, void> {
      const result = schema.safeParse(payload);
      if (!result.success) {
         return left(this.toValidationError(result.error));
      }
      return right(undefined);
   }

   private toValidationError(error: ZodError) {
      return new ValidationError(
         "400",
         error.errors.map((err) => err.message).join(", "),
      );
   }
}

export default ProdutoValidator;
