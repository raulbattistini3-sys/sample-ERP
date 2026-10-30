import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BillingNotificacaoSchema } from "../utils/schemas/billing_notificacao.schema";
import { billingEmail } from "../utils/mailer/billing_email.util";

// The billing service delivers each Stripe event at least once. The event id is the idempotency key, so a
// repeated delivery doesn't send a second e-mail and this needs no table of its own.
class BillingNotificacaoService {
  constructor(private readonly mailer: MailerInterface) {}

  async receber(payload: unknown): Promise<Either<BaseAppError, null>> {
    const parsed = BillingNotificacaoSchema.safeParse(payload);
    if (!parsed.success) {
      return left(new ValidationError("400", parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")));
    }
    const sent = await this.mailer.send(billingEmail(parsed.data), { idempotencyKey: `billing/${parsed.data.eventId}` });
    return sent.isLeft() ? left(sent.value) : right(null);
  }
}

export default BillingNotificacaoService;
