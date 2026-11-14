import BillingClient from "../integrations/billing/billing.client";
import HubspotService from "./hubspot.service";
import PagamentoRecorrenteRepository, { Alteracao, CicloRegistrado, PagamentoRecorrente } from "../repositories/pagamento_recorrente.repository";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import AvisosDeCobrancaService, { contatoDaCobranca } from "./avisos_cobranca.service";
import { cobrancaClienteEmail } from "../utils/mailer/cobranca_email.util";
import { semDestinatario } from "../utils/schemas/copias.schema";
import PagamentoRecorrenteValidator from "../validators/pagamento_recorrente.validator";

// Pagamento mensal (recorrente), modelled on Pix Automático: the client authorizes a ceiling per charge
// (valor máximo), the ERP may set a floor (valor mínimo), and the plan charges `valor` every N days or
// months from the start date, optionally until an end date. Every cycle is one Stripe invoice that the
// client pays by Pix or card through the link e-mailed to them; Stripe Billing subscriptions can't take
// Pix in Brazil, so the schedule runs here (PagamentoRecorrenteWorker).
//
// The client is read live from HubSpot on every cycle (never stored); only the plan and its cycles are.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TENTATIVAS = 5;
const centavos = (v: number) => Math.round(v * 100);

export type ClienteDoPlano = { id: string; nome: string; email: string | null; url: string | null };
export type PlanoDto = PagamentoRecorrente & { cliente: ClienteDoPlano | null; ciclos: CicloRegistrado[] };

type Usuario = { id: string; nome: string; email: string };
type Resultado = "emitida" | "falhou" | "adiada" | "pulado" | "nada";

const naoEncontrado = () => new ValidationError("404", "Pagamento recorrente não encontrado.");
const mesAno = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};
// 5, 15, 45 min, then 2h15, 6h45: a slow Stripe or HubSpot gets the day to come back
const espera = (tentativa: number) => 5 * 3 ** Math.max(0, tentativa - 1);

class PagamentoRecorrenteService {
  private readonly validator = new PagamentoRecorrenteValidator();
  constructor(
    private readonly planos: PagamentoRecorrenteRepository,
    private readonly hubspot: HubspotService,
    private readonly billing: BillingClient,
    private readonly mailer: MailerInterface,
    private readonly logger: LoggerInterface,
    private readonly avisos: AvisosDeCobrancaService | null = null,
  ) {}

  async criar(payload: unknown, usuario: Usuario): Promise<Either<BaseAppError, PlanoDto>> {
    const parsed = this.validator.parsePlano(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const p = parsed.value;
    if (p.dataInicio < (await this.planos.hoje())) return left(new ValidationError("400", "O início não pode ser no passado."));

    const contato = await this.hubspot.readContact(p.clienteId);
    if (contato.isLeft()) return left(contato.value);
    if (!contato.value) return left(new ValidationError("404", "Cliente não encontrado no HubSpot."));
    if (!contato.value.properties.email?.trim()) {
      return left(new ValidationError("422", "O cliente não tem e-mail no HubSpot: cada cobrança vai por e-mail. Cadastre o e-mail em Clientes."));
    }

    const plano = await this.planos.criar({
      hubspotContatoId: p.clienteId,
      descricao: p.descricao,
      valorCentavos: centavos(p.valor),
      valorMaximoCentavos: centavos(p.valorMaximo),
      valorMinimoCentavos: p.valorMinimo == null ? null : centavos(p.valorMinimo),
      intervalo: p.intervalo,
      unidade: p.unidade,
      vencimentoDias: p.vencimentoDias,
      dataInicio: p.dataInicio,
      dataFim: p.dataFim ?? null,
      cc: p.cc,
      cco: p.cco,
      criadoPor: usuario.id,
      criadoPorNome: usuario.nome,
      criadoPorEmail: usuario.email,
    });
    return right({ ...plano, cliente: this.cliente(contato.value), ciclos: [] });
  }

  // every plan, or one client's; the clients' names come from HubSpot, in one batch read
  async listar(clienteId: string | null): Promise<Either<BaseAppError, PlanoDto[]>> {
    if (clienteId !== null) {
      const idValido = this.validator.validateHubspotId(clienteId, "cliente");
      if (idValido.isLeft()) return left(idValido.value);
    }
    const planos = await this.planos.listar(clienteId);
    const ids = [...new Set(planos.map((p) => p.hubspotContatoId))];
    const contatos = ids.length ? await this.hubspot.readContacts(ids) : null;
    const porId = new Map((contatos?.isRight() ? contatos.value : []).map((c) => [c.id, this.cliente(c)]));
    const comCiclos = await Promise.all(planos.map(async (p) => ({ ...p, cliente: porId.get(p.hubspotContatoId) ?? null, ciclos: await this.planos.ciclos(p.id, 6) })));
    return right(comCiclos);
  }

  async obter(id: string): Promise<Either<BaseAppError, PlanoDto>> {
    if (!UUID.test(id)) return left(naoEncontrado());
    const plano = await this.planos.obter(id);
    if (!plano) return left(naoEncontrado());
    return right(await this.comDetalhes(plano));
  }

  async alterar(id: string, payload: unknown): Promise<Either<BaseAppError, PlanoDto>> {
    if (!UUID.test(id)) return left(naoEncontrado());
    const parsed = this.validator.parseAlteracao(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const atual = await this.planos.obter(id);
    if (!atual) return left(naoEncontrado());
    const a = parsed.value;
    if (a.dataFim && a.dataFim < atual.dataInicio) return left(new ValidationError("400", "O fim precisa ser depois do início."));
    const alteracao: Alteracao = {
      descricao: a.descricao,
      valorCentavos: centavos(a.valor),
      valorMaximoCentavos: centavos(a.valorMaximo),
      valorMinimoCentavos: a.valorMinimo == null ? null : centavos(a.valorMinimo),
      vencimentoDias: a.vencimentoDias,
      dataFim: a.dataFim ?? null,
      cc: a.cc,
      cco: a.cco,
    };
    const plano = await this.planos.alterar(id, alteracao);
    if (!plano) return left(new ValidationError("409", "Só um pagamento ativo ou pausado pode ser alterado."));
    return right(await this.comDetalhes(plano));
  }

  pausar(id: string) {
    return this.status(id, (i) => this.planos.pausar(i), "Só um pagamento ativo pode ser pausado.");
  }

  retomar(id: string) {
    return this.status(id, (i) => this.planos.retomar(i), "Só um pagamento pausado pode ser retomado.");
  }

  cancelar(id: string) {
    return this.status(id, (i) => this.planos.cancelar(i), "Este pagamento já foi encerrado ou cancelado.");
  }

  // Charges the plan's current cycle; the worker calls it with plans it has leased. Never throws.
  async executar(reservado: PagamentoRecorrente): Promise<Resultado> {
    try {
      const plano = reservado.proximaData < (await this.planos.hoje()) ? await this.planos.pularAtrasados(reservado.id) : reservado;
      if (!plano || plano.status !== "ativo" || plano.proximaData > (await this.planos.hoje())) {
        await this.planos.liberar(reservado.id);
        return reservado.proximaData !== plano?.proximaData ? "pulado" : "nada";
      }
      return await this.emitirCiclo(plano);
    } catch (error) {
      const mensagem = (error as Error).message;
      this.log(ErrorLevelsEnum.Values.ERROR, "ciclo de pagamento recorrente falhou", { pagamentoId: reservado.id, erro: mensagem });
      await this.planos.adiar(reservado.id, mensagem, espera(reservado.tentativas + 1)).catch(() => undefined);
      return "adiada";
    }
  }

  private async emitirCiclo(plano: PagamentoRecorrente): Promise<Resultado> {
    const { valorCentavos, valorMaximoCentavos, valorMinimoCentavos } = plano;
    // the database's checks keep these in order; this is the last guard before charging
    if (valorCentavos > valorMaximoCentavos || (valorMinimoCentavos !== null && valorCentavos < valorMinimoCentavos)) {
      await this.planos.concluirCiclo(plano, this.semFatura("pulado", valorCentavos, "valor fora dos limites autorizados"));
      return "pulado";
    }

    const contato = await this.hubspot.readContact(plano.hubspotContatoId);
    if (contato.isLeft()) return this.falha(plano, `HubSpot: ${contato.value.message}`);
    const email = contato.value?.properties.email?.trim();
    if (!contato.value || !email) return this.falha(plano, !contato.value ? "o contato não existe mais no HubSpot" : "o contato não tem e-mail no HubSpot");
    const cliente = this.cliente(contato.value);

    const descricao = `${plano.descricao} (${mesAno(plano.proximaData)})`.slice(0, 200);
    const criadas = await this.billing.criarCobrancas({
      // billing derives its Stripe idempotency keys from this: a retried cycle never makes a second invoice
      chave: `recorrente:${plano.id}:${plano.proximoCiclo}`,
      descricao,
      valorCentavos,
      vencimentoDias: plano.vencimentoDias,
      emissor: { nome: plano.criadoPorNome, email: plano.criadoPorEmail },
      clientes: [{ id: cliente.id, nome: cliente.nome, email }],
    });
    if (criadas.isLeft()) return this.falha(plano, `Stripe: ${criadas.value.message}`);
    const fatura = criadas.value[0];
    if (!fatura?.ok || !fatura.url) return this.falha(plano, `Stripe: ${fatura?.erro ?? "a fatura não foi criada"}`);

    const enviado = await this.mailer.send(
      {
        ...cobrancaClienteEmail({ email, nome: cliente.nome, descricao, valorCentavos, vencimento: fatura.vencimento, numero: fatura.numero, url: fatura.url, emissor: plano.criadoPorNome }),
        cc: semDestinatario(plano.cc, email),
        bcc: semDestinatario(plano.cco, email),
      },
      { idempotencyKey: `recorrente/${plano.id}/${plano.proximoCiclo}` },
    );
    if (enviado.isRight() && enviado.value.semCopias) this.log(ErrorLevelsEnum.Values.WARN, "cópias do pagamento recorrente recusadas pelo provedor de e-mail", { pagamentoId: plano.id });
    if (enviado.isLeft()) this.log(ErrorLevelsEnum.Values.WARN, "e-mail do pagamento recorrente não enviado", { pagamentoId: plano.id, erro: enviado.value.message });
    // HubSpot timeline note + WhatsApp; both keyed by the invoice, so a retried cycle doesn't repeat them
    if (this.avisos && fatura.faturaId) {
      await this.avisos.emitida({
        ...contatoDaCobranca(contato.value),
        faturaId: fatura.faturaId,
        numero: fatura.numero,
        descricao,
        valorCentavos,
        vencimento: fatura.vencimento,
        url: fatura.url,
        emissor: plano.criadoPorNome,
        email,
        recorrente: true,
      });
    }

    await this.planos.concluirCiclo(plano, {
      valorCentavos,
      status: "emitida",
      faturaId: fatura.faturaId,
      faturaNumero: fatura.numero,
      faturaUrl: fatura.url,
      vencimento: fatura.vencimento,
      emailEnviado: enviado.isRight(),
      erro: enviado.isLeft() ? `fatura emitida, mas o e-mail falhou: ${enviado.value.message}` : null,
    });
    return "emitida";
  }

  // retried with backoff; after MAX_TENTATIVAS the cycle is recorded as failed and the plan goes on
  private async falha(plano: PagamentoRecorrente, erro: string): Promise<Resultado> {
    const tentativa = plano.tentativas + 1;
    this.log(ErrorLevelsEnum.Values.WARN, "ciclo de pagamento recorrente não emitido", { pagamentoId: plano.id, ciclo: plano.proximoCiclo, tentativa, erro });
    if (tentativa >= MAX_TENTATIVAS) {
      await this.planos.concluirCiclo(plano, this.semFatura("falhou", plano.valorCentavos, `${erro} (${tentativa} tentativas)`));
      return "falhou";
    }
    await this.planos.adiar(plano.id, erro, espera(tentativa));
    return "adiada";
  }

  private semFatura(status: "falhou" | "pulado", valorCentavos: number, erro: string) {
    return { valorCentavos, status, faturaId: null, faturaNumero: null, faturaUrl: null, vencimento: null, emailEnviado: false, erro };
  }

  private async status(id: string, mudar: (id: string) => Promise<PagamentoRecorrente | null>, conflito: string): Promise<Either<BaseAppError, PlanoDto>> {
    if (!UUID.test(id)) return left(naoEncontrado());
    const plano = await mudar(id);
    if (plano) return right(await this.comDetalhes(plano));
    return left((await this.planos.obter(id)) ? new ValidationError("409", conflito) : naoEncontrado());
  }

  private async comDetalhes(plano: PagamentoRecorrente): Promise<PlanoDto> {
    const contato = await this.hubspot.readContact(plano.hubspotContatoId);
    const cliente = contato.isRight() && contato.value ? this.cliente(contato.value) : null;
    return { ...plano, cliente, ciclos: await this.planos.ciclos(plano.id) };
  }

  private cliente({ id, properties: p, url }: { id: string; properties: Record<string, string | null | undefined>; url?: string }): ClienteDoPlano {
    return {
      id,
      nome: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || `Contato ${id}`,
      email: p.email?.trim() || null,
      url: url ?? null,
    };
  }

  private log(level: (typeof ErrorLevelsEnum.Values)[keyof typeof ErrorLevelsEnum.Values], message: string, context: Record<string, unknown>) {
    this.logger.handle({ layer: "service", service: "PagamentoRecorrenteService", ...context }, level, message);
  }
}

export default PagamentoRecorrenteService;
