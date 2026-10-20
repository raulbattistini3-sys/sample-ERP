import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

export type MailMessage = {
   to: string;
   subject: string;
   html: string;
   text: string;
};

interface MailerInterface {
   send(message: MailMessage): Promise<Either<BaseAppError, null>>;
}

export default MailerInterface;
