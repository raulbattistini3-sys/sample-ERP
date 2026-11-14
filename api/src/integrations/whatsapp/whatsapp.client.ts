import { BaseAppError } from "../../errors/global_error.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { ValidationError } from "../../errors/client_errors/four_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";

// WhatsApp Cloud API (Meta). Configure with:
//   WHATSAPP_TOKEN            a system-user access token with whatsapp_business_messaging
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (WhatsApp Manager → API setup)
//   WHATSAPP_TEMPLATE         an approved template name. WhatsApp only delivers free text inside the 24 h
//                             after the client last wrote to you; a billing message starts the
//                             conversation, so production needs a template. Without one, plain text is sent.
//   WHATSAPP_TEMPLATE_IDIOMA  the template's language (default pt_BR)
//   WHATSAPP_API_VERSION      Graph API version (default v23.0)
const TIMEOUT_MS = 15_000;

// The template's body takes these, in order: {{1}} nome, {{2}} emissor, {{3}} número da fatura,
// {{4}} descrição, {{5}} valor, {{6}} vencimento, {{7}} link de pagamento.
export type ParametrosDoModelo = [string, string, string, string, string, string, string];

// A Brazilian number as WhatsApp wants it: digits only, with the country code. Numbers typed without
// one (10 or 11 digits, with or without a leading 0) are taken as Brazilian.
export const numeroWhatsapp = (telefone: string | null | undefined): string | null => {
  if (!telefone) return null;
  const internacional = telefone.trim().startsWith("+");
  let digitos = telefone.replace(/\D/g, "");
  if (!internacional) {
    digitos = digitos.replace(/^0+/, "");
    if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  }
  return digitos.length >= 12 && digitos.length <= 15 ? digitos : null;
};

class WhatsappClient {
  constructor(
    private readonly token = process.env.WHATSAPP_TOKEN,
    private readonly numeroId = process.env.WHATSAPP_PHONE_NUMBER_ID,
    private readonly modelo = process.env.WHATSAPP_TEMPLATE || null,
    private readonly idioma = process.env.WHATSAPP_TEMPLATE_IDIOMA || "pt_BR",
    private readonly versao = process.env.WHATSAPP_API_VERSION || "v23.0",
  ) {}

  get configurado() {
    return !!this.token && !!this.numeroId;
  }

  // the template when there is one (its parameters), else the text; returns the message id
  async enviar(para: string, texto: string, parametros: ParametrosDoModelo): Promise<Either<BaseAppError, string>> {
    if (!this.configurado) return left(new ServerError("503", true, "WhatsApp não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID)."));
    const mensagem = this.modelo
      ? {
          type: "template",
          template: {
            name: this.modelo,
            language: { code: this.idioma },
            components: [{ type: "body", parameters: parametros.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }],
          },
        }
      : { type: "text", text: { preview_url: true, body: texto.slice(0, 4096) } };
    try {
      const res = await fetch(`https://graph.facebook.com/${this.versao}/${this.numeroId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: para, ...mensagem }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const corpo = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (!res.ok) {
        const motivo = corpo.error?.message ?? `HTTP ${res.status}`;
        // 4xx: the number, template or token is wrong — retrying won't help
        return left(res.status < 500 ? new ValidationError("400", `WhatsApp recusou a mensagem: ${motivo}`) : new ServerError("503", true, `WhatsApp: ${motivo}`));
      }
      return right(corpo.messages?.[0]?.id ?? "");
    } catch (error) {
      return left(new ServerError("503", true, "WhatsApp fora do ar.", error));
    }
  }
}

export default WhatsappClient;
