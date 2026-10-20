import "dotenv/config";
import { Resend } from "resend";
import MailerInterface, { MailMessage } from "../../interfaces/mailer_interfaces/mailer.interface";
import { BaseAppError } from "../../errors/global_error.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";

// Resend's shared test sender: works without a verified domain, but only delivers to the email
// of the Resend account that owns RESEND_API_KEY. Set EMAIL_FROM to an address on a verified domain
// to send to anyone.
const DEFAULT_FROM = "ERP Estoque <onboarding@resend.dev>";

class ResendMailer implements MailerInterface {
   private readonly client: Resend | null;

   constructor(
      apiKey = process.env.RESEND_API_KEY,
      private readonly from = process.env.EMAIL_FROM || DEFAULT_FROM,
   ) {
      // new Resend() throws without a key; report it per send instead of crashing the API at startup
      this.client = apiKey ? new Resend(apiKey) : null;
   }

   async send(message: MailMessage): Promise<Either<BaseAppError, null>> {
      if (!this.client) {
         return left(new ServerError("500", true, "RESEND_API_KEY não está configurada"));
      }
      try {
         const { error } = await this.client.emails.send({ from: this.from, ...message });
         if (error) {
            return left(new ServerError("500", true, `Resend recusou o e-mail: ${error.message}`, error));
         }
         return right(null);
      } catch (error) {
         return left(new ServerError("500", true, "Falha ao chamar o Resend", error));
      }
   }
}

export default ResendMailer;
