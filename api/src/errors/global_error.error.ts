import { ZodErrorStatusEnum } from "../enums/errors_enums/errors_status.enum";

class BaseAppError extends Error {
   public readonly statusCode: string;
   public readonly status: ZodErrorStatusEnum;
   public readonly isOperational: boolean;
   // the lower-layer error this one wraps (e.g. the driver error behind a RepositoryError)
   public readonly cause?: unknown;
   constructor(
      statusCode: string,
      status: ZodErrorStatusEnum,
      isOperational: boolean,
      message?: string,
      cause?: unknown,
   ) {
      super(message);
      this.name = new.target.name;
      this.statusCode = statusCode;
      this.status = status;
      this.isOperational = isOperational;
      this.cause = cause;

      Object.setPrototypeOf(this, new.target.prototype);
   }
}

export { BaseAppError };
