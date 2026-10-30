import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

export type MailMessage = {
   to: string;
   subject: string;
   html: string;
   text: string;
};

// the same key is only sent once, so a retried delivery can't repeat an e-mail
export type MailOptions = { idempotencyKey?: string };

interface MailerInterface {
   send(message: MailMessage, options?: MailOptions): Promise<Either<BaseAppError, null>>;
}

export default MailerInterface;
