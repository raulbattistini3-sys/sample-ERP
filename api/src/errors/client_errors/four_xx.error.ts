import ZodErrorStatusEnum from "../../enums/errors_enums/errors_status.enum";
import { BaseAppError } from "../global_error.error";

const ValidationErrorsStatusCodeValues = [
   "400",
   "401",
   "403",
   "404",
   "422",
] as const;
type ValidationErrorsStatusCode =
   (typeof ValidationErrorsStatusCodeValues)[number];

class ValidationError extends BaseAppError {
   public statusCode: ValidationErrorsStatusCode;
   public isOperational: false;
   constructor(
      statusCode: ValidationErrorsStatusCode,
      message?: string,
      cause?: unknown,
   ) {
      super(statusCode, ZodErrorStatusEnum.Values.error, false, message, cause);

      this.statusCode = statusCode;
      this.isOperational = false;

      Object.setPrototypeOf(this, new.target.prototype);
   }
}

export { ValidationError };
