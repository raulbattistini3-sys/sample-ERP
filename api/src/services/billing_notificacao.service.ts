import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BillingNotificacaoSchema } from "../utils/schemas/billing_notificacao.schema";
import { billingEmail } from "../utils/mailer/billing_email.util";

// the SAC e-mail of the company the client belongs to (Criar empresa), or null
export type SacDoCliente = (email: string) => Promise<string | null>;
// a paid invoice: HubSpot timeline note + lifecycle stage "customer" (AvisosDeCobrancaService.paga)
export type AoPagar = (fatura: { faturaId: string; numero: string | null; valorCentavos: number; email: string; nome: string | null; url: string | null }) => Promise<unknown>;

// The billing service delivers each Stripe event at least once. The event id is the idempotency key, so a
// repeated delivery doesn't send a second e-mail and this needs no table of its own.
class BillingNotificacaoService {
  constructor(
    private readonly mailer: MailerInterface,
    private readonly sacDoCliente: SacDoCliente = async () => null,
    private readonly aoPagar: AoPagar | null = null,
  ) {}

  async receber(payload: unknown): Promise<Either<BaseAppError, null>> {
    const parsed = BillingNotificacaoSchema.safeParse(payload);
    if (!parsed.success) {
      return left(new ValidationError("400", parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")));
    }
    // a failed payment: the company's SAC is copied, so someone there can follow up. Not finding it
    // (HubSpot down, no company, no SAC) never holds the client's e-mail back.
    let cc: string[] = [];
    if (parsed.data.tipo === "fatura_falhou") {
      const sac = await this.sacDoCliente(parsed.data.email).catch(() => null);
      if (sac && sac !== parsed.data.email.toLowerCase()) cc = [sac];
    }
    // before the e-mail: if the e-mail fails, billing redelivers and envios_externos skips what was done
    if (parsed.data.tipo === "fatura_paga" && this.aoPagar) {
      const { faturaId, numero, valorCentavos, email, nome, url } = parsed.data;
      await this.aoPagar({ faturaId, numero: numero ?? null, valorCentavos, email, nome: nome ?? null, url: url ?? null }).catch(() => undefined);
    }
    const sent = await this.mailer.send({ ...billingEmail(parsed.data), cc }, { idempotencyKey: `billing/${parsed.data.eventId}` });
    return sent.isLeft() ? left(sent.value) : right(null);
  }
}

export default BillingNotificacaoService;
