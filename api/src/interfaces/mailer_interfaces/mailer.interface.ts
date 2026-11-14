import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

export type MailMessage = {
   to: string;
   subject: string;
   html: string;
   text: string;
   cc?: string[]; // copies (CC)
   bcc?: string[]; // blind copies (CCO)
};

// the same key is only sent once, so a retried delivery can't repeat an e-mail
export type MailOptions = { idempotencyKey?: string };

// semCopias: the provider refused the copies, so the e-mail went to `to` alone (Resend's test sender
// only delivers to the account's own address)
export type MailSent = { semCopias: boolean };

interface MailerInterface {
   send(message: MailMessage, options?: MailOptions): Promise<Either<BaseAppError, MailSent>>;
}

export default MailerInterface;
