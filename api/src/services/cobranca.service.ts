import { randomUUID } from "node:crypto";
import BillingClient, { FaturaRecente, PaginaDeFaturas, ResultadoCobranca } from "../integrations/billing/billing.client";
import { FaturaPagaEvento, faturasPagas } from "../utils/cache/faturas_pagas";
import HubspotService from "./hubspot.service";
import { BaseAppError } from "../errors/global_error.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { semDestinatario } from "../utils/schemas/copias.schema";
import CobrancaValidator from "../validators/cobranca.validator";
import { cobrancaClienteEmail, cobrancaEmissorEmail, LinhaResumo } from "../utils/mailer/cobranca_email.util";
import AvisosDeCobrancaService, { contatoDaCobranca, WhatsappStatus } from "./avisos_cobranca.service";

// semCopias: the e-mail reached the client, but the provider refused the CC/CCO
// notaNoHubspot / whatsapp: the timeline note and the WhatsApp message (AvisosDeCobrancaService)
export type ResultadoCliente = LinhaResumo & {
  clienteId: string;
  vencimento: string | null;
  semCopias: boolean;
  notaNoHubspot: boolean;
  whatsapp: WhatsappStatus | null;
};
export type RespostaCobranca = { resultados: ResultadoCliente[]; emissorNotificado: boolean; erroEmailEmissor: string | null };

type Emissor = { nome: string; email: string };

// Cobranças: the selected clients are read live from HubSpot (never stored), billing creates one Stripe
// invoice per client, and each client gets its payment link by e-mail through Resend, from the sender of
// COBRANCAS_EMAIL_FROM (else EMAIL_FROM). The issuer gets a summary of every client.
//
// `chave` is the request's Idempotency-Key: billing derives its Stripe keys from it and the e-mails use it
// as theirs, so a retried request bills nobody twice and mails nobody twice.
const comPagamento = (f: FaturaRecente): FaturaRecente => {
  if (f.status === "paid") return f;
  const paga = faturasPagas.ler(f.id);
  return paga ? { ...f, status: "paid", pagoCentavos: paga.valorCentavos, pagaEm: paga.pagaEm } : f;
};

// what the webhook says, in the shape of Stripe's invoice; what it doesn't carry comes with the index
const daWebhook = (f: FaturaPagaEvento): FaturaRecente => ({
  id: f.faturaId,
  numero: f.numero,
  status: "paid",
  clienteNome: f.nome,
  clienteEmail: f.email,
  valorCentavos: f.valorCentavos,
  pagoCentavos: f.valorCentavos,
  criadaEm: f.pagaEm,
  vencimento: null,
  url: f.url,
  emissor: null,
  pagaEm: f.pagaEm,
});

class CobrancaService {
  private readonly validator = new CobrancaValidator();
  constructor(
    private readonly hubspot: HubspotService,
    private readonly billing: BillingClient,
    private readonly mailer: MailerInterface,
    private readonly logger: LoggerInterface,
    private readonly avisos: AvisosDeCobrancaService | null = null,
  ) {}

  async emitir(payload: unknown, emissor: Emissor, chave: string = randomUUID()): Promise<Either<BaseAppError, RespostaCobranca>> {
    const parsed = this.validator.parseCobranca(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const { clienteIds, descricao, valor, vencimentoDias, cc, cco } = parsed.value;

    const contatos = await this.hubspot.readContacts([...new Set(clienteIds)]);
    if (contatos.isLeft()) return left(contatos.value);
    const clientes = contatos.value.map((contato) => {
      const { contatoId, nome, telefone, empresaId } = contatoDaCobranca(contato);
      return { id: contatoId, nome, email: contato.properties.email?.trim() || null, telefone, empresaId };
    });
    const comEmail = clientes.filter((c): c is typeof c & { email: string } => !!c.email);

    const valorCentavos = Math.round(valor * 100);
    let resultados: ResultadoCobranca[] = [];
    if (comEmail.length > 0) {
      const criadas = await this.billing.criarCobrancas({
        chave, descricao, valorCentavos, vencimentoDias, emissor,
        clientes: comEmail.map(({ id, nome, email }) => ({ id, nome, email })),
      });
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
        semCopias: false,
        notaNoHubspot: false,
        whatsapp: null,
      };
      if (linha.ok && linha.url && cliente.email) {
        const sent = await this.mailer.send(
          {
            ...cobrancaClienteEmail({ email: cliente.email, nome: cliente.nome, descricao, valorCentavos, vencimento: linha.vencimento, numero: linha.numero, url: linha.url, emissor: emissor.nome }),
            cc: semDestinatario(cc, cliente.email),
            bcc: semDestinatario(cco, cliente.email),
          },
          { idempotencyKey: `cobranca/${chave}/${cliente.id}` },
        );
        linha.emailEnviado = sent.isRight();
        if (sent.isRight() && sent.value.semCopias) {
          linha.semCopias = true;
          this.log("cópias da cobrança recusadas pelo provedor de e-mail", { clienteId: cliente.id });
        }
        if (sent.isLeft()) {
          linha.erro = `fatura emitida, mas o e-mail falhou: ${sent.value.message}`;
          this.log("e-mail de cobrança não enviado", { clienteId: cliente.id, erro: sent.value.message });
        }
      }
      if (linha.ok && r?.faturaId && cliente.email && this.avisos) {
        const avisos = await this.avisos.emitida({
          faturaId: r.faturaId,
          numero: linha.numero,
          descricao,
          valorCentavos,
          vencimento: linha.vencimento,
          url: linha.url,
          emissor: emissor.nome,
          contatoId: cliente.id,
          nome: cliente.nome,
          email: cliente.email,
          telefone: cliente.telefone,
          empresaId: cliente.empresaId,
        });
        linha.notaNoHubspot = avisos.notaNoHubspot;
        linha.whatsapp = avisos.whatsapp;
      }
      linhas.push(linha);
    }

    const resumo = await this.mailer.send(cobrancaEmissorEmail(emissor, descricao, valorCentavos, linhas), {
      idempotencyKey: `cobranca/${chave}/emissor`,
    });
    if (resumo.isLeft()) this.log("resumo de cobrança não enviado ao emissor", { erro: resumo.value.message });

    return right({ resultados: linhas, emissorNotificado: resumo.isRight(), erroEmailEmissor: resumo.isLeft() ? resumo.value.message : null });
  }

  // Stripe's search index runs about a minute behind: an invoice the webhook already reported as paid
  // is shown paid here instead of "Em aberto"
  async recentes(): Promise<Either<BaseAppError, FaturaRecente[]>> {
    const lidas = await this.billing.recentes();
    if (lidas.isLeft()) return lidas;
    return right(lidas.value.map(comPagamento));
  }

  // the paid invoices, newest first, a page at a time ("pagina" is the previous page's "proxima"). The first
  // page also brings what was paid in the last minutes and isn't in Stripe's index yet.
  async pagas(pagina: string | null, limite: number): Promise<Either<BaseAppError, PaginaDeFaturas>> {
    const lidas = await this.billing.pagas(pagina, limite);
    if (lidas.isLeft()) return lidas;
    if (pagina) return lidas;
    const ja = new Set(lidas.value.faturas.map((f) => f.id));
    const novas = faturasPagas.todas().filter((f) => !ja.has(f.faturaId)).map(daWebhook);
    return right({ ...lidas.value, faturas: [...novas, ...lidas.value.faturas] });
  }

  private log(message: string, context: Record<string, unknown>) {
    this.logger.handle({ layer: "service", service: "CobrancaService", ...context }, ErrorLevelsEnum.Values.WARN, message);
  }
}

export default CobrancaService;
