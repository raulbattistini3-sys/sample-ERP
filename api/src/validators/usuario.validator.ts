import ZodErrorStatusEnum from "../enums/errors_enums/errors_status.enum";
import { BaseAppError } from "../errors/global_error.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { IUsuarioValidator } from "../interfaces/usuario_interfaces/usuario_validator.interface";
import { ZodTypeAny } from "zod";
import {
   CreateUserSchema,
   ChangePasswordSchema,
   ForgotPasswordSchema,
   LoginUserSchema,
   ResetPasswordSchema,
   RegisterUserSchema,
   UpdateUserSchema,
} from "../utils/schemas/user.schema";
import BaseValidator from "./base.validator";
import { isCpfValido, isDataNascimentoValida } from "./cpf.validator";

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

   validateChangePasswordPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(ChangePasswordSchema, payload);
   }

   validateLoginPayload(payload: unknown): Either<BaseAppError, void> {
      return this.validateWith(LoginUserSchema, payload);
   }

   // a CPF with valid check digits (punctuation allowed)
   validateCpf(cpf: unknown): Either<BaseAppError, void> {
      if (typeof cpf === "string" && isCpfValido(cpf)) return right(undefined);
      return left(new BaseAppError("400", ZodErrorStatusEnum.Values.error, false, "CPF inválido."));
   }

   // a birth date as YYYY-MM-DD, a real date and not in the future
   validateDataNascimento(data: unknown): Either<BaseAppError, void> {
      if (typeof data === "string" && isDataNascimentoValida(data)) return right(undefined);
      return left(
         new BaseAppError("400", ZodErrorStatusEnum.Values.error, false, "A data de nascimento deve estar no formato AAAA-MM-DD."),
      );
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
