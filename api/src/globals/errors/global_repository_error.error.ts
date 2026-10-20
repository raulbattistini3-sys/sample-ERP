import ServerSideErrorsEnum from "../../enums/errors_enums/errors_status_codes.enum";
import { ServerError } from "../../errors/server_errors/five_xx.error";

export class RepositoryError extends ServerError {
    constructor(message: string, cause?: unknown) {
        super(ServerSideErrorsEnum.SERVER_SIDE_ERRORS_ENUM.Values["500"], true, message, cause);
    }
}