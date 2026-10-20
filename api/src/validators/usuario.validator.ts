import ZodErrorStatusEnum from "../enums/errors_enums/errors_status.enum";
import { BaseAppError } from "../errors/global_error.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { IUsuarioValidator } from "../interfaces/usuario_interfaces/usuario_validator.interface";
import { ZodTypeAny } from "zod";
import {
   CreateUserSchema,
   ForgotPasswordSchema,
   LoginUserSchema,
   ResetPasswordSchema,
   RegisterUserSchema,
   UpdateUserSchema,
} from "../utils/schemas/user.schema";
import BaseValidator from "./base.validator";

class UsuarioValidator extends BaseValidator implements IUsuarioValidator {
   constructor() {
      super();
   }

   validateCreatePayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(CreateUserSchema, payload);
   }

   validateUpdatePayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(UpdateUserSchema, payload);
   }

   validateRegisterPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(RegisterUserSchema, payload);
   }

   validateForgotPasswordPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(ForgotPasswordSchema, payload);
   }

   validateResetPasswordPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(ResetPasswordSchema, payload);
   }

   validateLoginPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(LoginUserSchema, payload);
   }

   private validateWith(schema: ZodTypeAny, payload: unknown): Either<BaseAppError, void> {
      const result = schema.safeParse(payload);

      if (!result.success) {
         return left(
            new BaseAppError(
               "400",
               ZodErrorStatusEnum.Values.error,
               false,
               result.error.errors.map((err) => err.message).join(", "),
            ),
         );
      }

      return right(undefined);
   }
}

export default UsuarioValidator;
