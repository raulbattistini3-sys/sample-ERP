import { Request, NextFunction } from "express";
import { BaseAppError } from "../errors/global_error.error";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import serializeError from "../utils/logger/serialize_error.util";

// controllers depend on LoggerInterface only; the routes (composition root) inject the concrete logger
abstract class BaseController {
   constructor(protected readonly logger: LoggerInterface) {}

   // logs an error returned by the service/repository layers, then hands it to BaseErrorMiddleware for the response
   protected fail(req: Request, next: NextFunction, error: BaseAppError) {
      const statusCode = Number(error.statusCode);
      const level =
         statusCode >= 500
            ? ErrorLevelsEnum.Values.ERROR
            : ErrorLevelsEnum.Values.WARN;

      // request body is left out on purpose: it can carry passwords (login/register)
      this.logger.handle(
         {
            layer: "controller",
            controller: this.constructor.name,
            method: req.method,
            route: `${req.baseUrl}${req.route?.path ?? ""}`,
            url: req.originalUrl,
            params: req.params,
            statusCode,
            error: serializeError(error),
         },
         level,
         error.message,
      );

      return next(error);
   }
}

export default BaseController;
