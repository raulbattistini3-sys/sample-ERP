import ZodErrorStatusEnum from "../../enums/errors_enums/errors_status.enum";
import { ServerSideErrorsEnum } from "../../enums/errors_enums/errors_status_codes.enum";
import { BaseAppError } from "../global_error.error";

class ServerError extends BaseAppError {
    public statusCode: ServerSideErrorsEnum;
    public isOperational: boolean;
    constructor(
        statusCode: ServerSideErrorsEnum,
        isOperational: boolean,
        message?: string,
        cause?: unknown
    ) {
        super(
            statusCode,
            ZodErrorStatusEnum.Values.error,
            isOperational,
            message,
            cause
        );

        this.statusCode = statusCode;
        this.isOperational = isOperational;

        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export { ServerError };
