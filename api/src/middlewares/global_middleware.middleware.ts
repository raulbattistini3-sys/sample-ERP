import { Request, Response, NextFunction } from "express";
import { BaseAppError } from "../errors/global_error.error";
import { DEFAULT_STATUS_CODE } from "../globals/global_error.global";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { INTERNAL_SERVER_ERROR_OBJ } from "../globals/errors/global_http_error.global";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import serializeError from "../utils/logger/serialize_error.util";
import toHttpStatus from "../utils/helpers/http_status.util";

class BaseErrorMiddleware {
    constructor(private readonly logger: LoggerInterface) {}

    // arrow function so `this` survives being passed to app.use; express needs all four params to treat it as an error handler
    handle = (err: Error, req: Request, res: Response, next: NextFunction) => {
        // BaseAppErrors were already logged by BaseController.fail; only shape the response here
        if (err instanceof BaseAppError) {
            return res.status(toHttpStatus(err.statusCode)).json({
                message: err.message,
                status: err.status,
            });
        }

        // express.json() rejects malformed or oversized bodies with a 4xx status: the client's mistake, not ours
        const bodyParserStatus = (err as { status?: unknown }).status;
        if (typeof bodyParserStatus === "number" && bodyParserStatus >= 400 && bodyParserStatus < 500) {
            const type = (err as { type?: unknown }).type;
            const message =
                type === "entity.too.large"
                    ? "Requisição grande demais."
                    : type === "entity.parse.failed"
                      ? "O corpo da requisição não é um JSON válido."
                      : "Requisição inválida.";
            return res.status(bodyParserStatus).json({ message, status: "error" });
        }

        // anything else was thrown outside the Either flow (a bug, ...) and hasn't been logged yet;
        // Express 5 forwards rejected promises from async controllers here too
        this.logger.handle(
            {
                layer: "middleware",
                method: req.method,
                url: req.originalUrl,
                statusCode: DEFAULT_STATUS_CODE,
                error: serializeError(err),
            },
            ErrorLevelsEnum.Values.ERROR,
            err.message,
        );

        return res.status(DEFAULT_STATUS_CODE).json(INTERNAL_SERVER_ERROR_OBJ);
    };
}

export default BaseErrorMiddleware;
