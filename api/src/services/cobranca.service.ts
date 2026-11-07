import { randomUUID } from "node:crypto";
import { z } from "zod";
import BillingClient, { FaturaRecente, ResultadoCobranca } from "../integrations/billing/billing.client";
import HubspotService from "./hubspot.service";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { cobrancaClienteEmail, cobrancaEmissorEmail, LinhaResumo } from "../utils/mailer/cobranca_email.util";

export const CobrancaSchema = z.object({
  clienteIds: z.array(z.string().regex(/^\d+$/, "id de cliente inválido")).min(1, "Escolha pelo menos um cliente.").max(50, "No máximo 50 clientes por vez."),
  descricao: z.string().trim().min(1, "Informe a descrição.").max(200, "A descrição aceita até 200 caracteres."),
  valor: z.number({ invalid_type_error: "Informe o valor." }).min(1, "O valor mínimo é R$ 1,00.").max(1_000_000, "O valor máximo é R$ 1.000.000,00."),
  vencimentoDias: z.number().int().min(1).max(60).default(7),
});

export type ResultadoCliente = LinhaResumo & { clienteId: string; vencimento: string | null };
export type RespostaCobranca = { resultados: ResultadoCliente[]; emissorNotificado: boolean; erroEmailEmissor: string | null };

type Emissor = { nome: string; email: string };

// Cobranças: the selected clients are read live from HubSpot (never stored), billing creates one Stripe
// invoice per client, and each client gets its payment link by e-mail through Resend, from the sender of
// COBRANCAS_EMAIL_FROM (else EMAIL_FROM). The issuer gets a summary of every client.
//
// `chave` is the request's Idempotency-Key: billing derives its Stripe keys from it and the e-mails use it
// as theirs, so a retried request bills nobody twice and mails nobody twice.
class CobrancaService {
  constructor(
    private readonly hubspot: HubspotService,
    private readonly billing: BillingClient,
    private readonly mailer: MailerInterface,
    private readonly logger: LoggerInterface,
  ) {}

  async emitir(payload: unknown, emissor: Emissor, chave: string = randomUUID()): Promise<Either<BaseAppError, RespostaCobranca>> {
    const parsed = CobrancaSchema.safeParse(payload);
    if (!parsed.success) {
      return left(new ValidationError("400", parsed.error.errors.map((e) => e.message).join(" ")));
    }
    const { clienteIds, descricao, valor, vencimentoDias } = parsed.data;

    const contatos = await this.hubspot.readContacts([...new Set(clienteIds)]);
    if (contatos.isLeft()) return left(contatos.value);
    const clientes = contatos.value.map(({ id, properties: p }) => ({
      id,
      nome: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || `Contato ${id}`,
      email: p.email?.trim() || null,
    }));
    const comEmail = clientes.filter((c): c is typeof c & { email: string } => !!c.email);

    const valorCentavos = Math.round(valor * 100);
    let resultados: ResultadoCobranca[] = [];
    if (comEmail.length > 0) {
      const criadas = await this.billing.criarCobrancas({ chave, descricao, valorCentavos, vencimentoDias, emissor, clientes: comEmail });
      if (criadas.isLeft()) return left(criadas.value);
      resultados = criadas.value;
    }
    const porCliente = new Map(resultados.map((r) => [r.clienteId, r]));

    const linhas: ResultadoCliente[] = [];
    for (const cliente of clientes) {
      const r = porCliente.get(cliente.id);
      const linha: ResultadoCliente = {
        clienteId: cliente.id,
        nome: cliente.nome,
        email: cliente.email,
        ok: !!r?.ok,
        numero: r?.numero ?? null,
        url: r?.url ?? null,
        vencimento: r?.vencimento ?? null,
        erro: !cliente.email ? "o contato não tem e-mail no HubSpot" : (r?.erro ?? (r ? null : "não processado")),
        emailEnviado: false,
      };
      if (linha.ok && linha.url && cliente.email) {
        const sent = await this.mailer.send(
          cobrancaClienteEmail({ email: cliente.email, nome: cliente.nome, descricao, valorCentavos, vencimento: linha.vencimento, numero: linha.numero, url: linha.url, emissor: emissor.nome }),
          { idempotencyKey: `cobranca/${chave}/${cliente.id}` },
        );
        linha.emailEnviado = sent.isRight();
        if (sent.isLeft()) {
          linha.erro = `fatura emitida, mas o e-mail falhou: ${sent.value.message}`;
          this.log("e-mail de cobrança não enviado", { clienteId: cliente.id, erro: sent.value.message });
        }
      }
      linhas.push(linha);
    }

    const resumo = await this.mailer.send(cobrancaEmissorEmail(emissor, descricao, valorCentavos, linhas), {
      idempotencyKey: `cobranca/${chave}/emissor`,
    });
    if (resumo.isLeft()) this.log("resumo de cobrança não enviado ao emissor", { erro: resumo.value.message });

    return right({ resultados: linhas, emissorNotificado: resumo.isRight(), erroEmailEmissor: resumo.isLeft() ? resumo.value.message : null });
  }

  recentes(): Promise<Either<BaseAppError, FaturaRecente[]>> {
    return this.billing.recentes();
  }

  private log(message: string, context: Record<string, unknown>) {
    this.logger.handle({ layer: "service", service: "CobrancaService", ...context }, ErrorLevelsEnum.Values.WARN, message);
  }
}

export default CobrancaService;
