import HubspotService, { HubspotContact } from "./hubspot.service";
import BillingClient, { FaturaRecente } from "../integrations/billing/billing.client";
import WhatsappClient, { numeroWhatsapp } from "../integrations/whatsapp/whatsapp.client";
import EnviosExternosRepository, { Canal } from "../repositories/envios_externos.repository";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { cobrancaClienteEmail, dia, reais } from "../utils/mailer/cobranca_email.util";
import { escapeHtml } from "../utils/mailer/password_reset_email.util";

// What happens around a cobrança besides the e-mail:
//  - a note on the client's HubSpot timeline (contact and its company) when the invoice is issued, and
//    another when it is paid;
//  - the paid invoice moves the contact and its company to "customer" (Funil);
//  - the same message as the e-mail, by WhatsApp, to the client's phone.
// Every send goes through envios_externos, so webhooks delivered twice, retried cycles and the backfill
// (sincronizar) never post anything twice. None of this ever fails the cobrança: problems come back as
// warnings and are logged.

export type CobrancaEmitida = {
  faturaId: string;
  numero: string | null;
  descricao: string;
  valorCentavos: number;
  vencimento: string | null;
  url: string | null;
  emissor: string;
  contatoId: string;
  nome: string;
  email: string;
  telefone: string | null;
  empresaId: string | null;
  recorrente?: boolean;
  // for the backfill: when it really happened (else now)
  quando?: string | null;
};

export type FaturaPaga = {
  faturaId: string;
  numero: string | null;
  valorCentavos: number;
  email: string | null;
  contatoId?: string | null;
  quando?: string | null;
};

export type WhatsappStatus = "enviado" | "ja_enviado" | "sem_telefone" | "desligado" | "falhou";
export type Avisos = { notaNoHubspot: boolean; whatsapp: WhatsappStatus; erros: string[] };

export type Sincronizacao = {
  rodando: boolean;
  iniciadaEm: string | null;
  terminadaEm: string | null;
  faturas: number;
  notas: number;
  pagas: number;
  semCliente: number;
  erros: string[];
};

const ESTAGIO_CLIENTE = "customer";
const ACIMA_DE_CLIENTE = new Set(["customer", "evangelist"]);
// the backfill walks at most this many pages of 100 invoices
const MAX_PAGINAS = 100;

export const contatoDaCobranca = (c: HubspotContact) => ({
  contatoId: c.id,
  nome: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || c.properties.email || `Contato ${c.id}`,
  telefone: c.properties.mobilephone?.trim() || c.properties.phone?.trim() || null,
  empresaId: c.properties.associatedcompanyid?.trim() || null,
});

class AvisosDeCobrancaService {
  private estado: Sincronizacao = { rodando: false, iniciadaEm: null, terminadaEm: null, faturas: 0, notas: 0, pagas: 0, semCliente: 0, erros: [] };

  constructor(
    private readonly hubspot: HubspotService,
    private readonly billing: BillingClient,
    private readonly envios: EnviosExternosRepository,
    private readonly whatsapp: WhatsappClient,
    private readonly logger: LoggerInterface,
  ) {}

  get whatsappConfigurado() {
    return this.whatsapp.configurado;
  }

  // after the invoice exists and the e-mail went out (or failed): timeline note + WhatsApp
  async emitida(c: CobrancaEmitida, opcoes: { whatsapp?: boolean } = {}): Promise<Avisos> {
    const erros: string[] = [];
    const nota = await this.nota(`nota:fatura:${c.faturaId}`, notaDeEmissao(c), c.quando, c.contatoId, c.empresaId).catch((e: Error) => e.message);
    if (typeof nota === "string") erros.push(`HubSpot: ${nota}`);

    let whatsapp: WhatsappStatus = "desligado";
    if (opcoes.whatsapp !== false && c.url) {
      whatsapp = await this.enviarWhatsapp(c).catch((e: Error) => {
        erros.push(`WhatsApp: ${e.message}`);
        return "falhou" as const;
      });
    }
    if (erros.length) this.log(ErrorLevelsEnum.Values.WARN, "avisos da cobrança incompletos", { faturaId: c.faturaId, erros });
    return { notaNoHubspot: nota === true, whatsapp, erros };
  }

  // the billing webhook (invoice.paid) and the backfill: note + lifecycle stage "customer"
  async paga(f: FaturaPaga): Promise<string[]> {
    const erros: string[] = [];
    let contato: HubspotContact | null = null;
    if (f.contatoId) {
      const lido = await this.hubspot.readContact(f.contatoId);
      if (lido.isRight()) contato = lido.value;
    }
    if (!contato && f.email) {
      const lidos = await this.hubspot.readContactsByEmail([f.email]);
      if (lidos.isLeft()) return [`HubSpot: ${lidos.value.message}`];
      contato = lidos.value[0] ?? null;
    }
    if (!contato) return [`nenhum contato no HubSpot para ${f.email ?? f.contatoId ?? "a fatura"}`];
    const empresaId = contato.properties.associatedcompanyid?.trim() || null;

    const corpo = `<p><strong>Pagamento confirmado</strong>${f.numero ? ` — fatura ${escapeHtml(f.numero)}` : ""}</p>
<p>${escapeHtml(reais(f.valorCentavos))} recebidos pelo Stripe. O cliente passou para a etapa <em>Cliente</em> do funil.</p>`;
    const nota = await this.nota(`nota:pago:${f.faturaId}`, corpo, f.quando, contato.id, empresaId).catch((e: Error) => e.message);
    if (typeof nota === "string") erros.push(`HubSpot: ${nota}`);

    // lifecycle stages only move forward here: an evangelist stays one
    if (!ACIMA_DE_CLIENTE.has(contato.properties.lifecyclestage ?? "")) {
      const r = await this.hubspot.setLifecycleStage("contacts", contato.id, ESTAGIO_CLIENTE);
      if (r.isLeft()) erros.push(`etapa do contato: ${r.value.message}`);
    }
    if (empresaId) {
      const empresa = await this.hubspot.readCompany(empresaId);
      if (empresa.isLeft()) erros.push(`empresa: ${empresa.value.message}`);
      else if (empresa.value && !ACIMA_DE_CLIENTE.has(empresa.value.properties.lifecyclestage ?? "")) {
        const r = await this.hubspot.setLifecycleStage("companies", empresaId, ESTAGIO_CLIENTE);
        if (r.isLeft()) erros.push(`etapa da empresa: ${r.value.message}`);
      }
    }
    if (erros.length) this.log(ErrorLevelsEnum.Values.WARN, "pagamento confirmado com avisos", { faturaId: f.faturaId, erros });
    return erros;
  }

  sincronizacao(): Sincronizacao {
    return { ...this.estado, erros: this.estado.erros.slice(0, 50) };
  }

  // Backfill: every invoice the ERP issued in Stripe (one-time and recurring) gets its timeline note,
  // dated when it was issued, and the paid ones their payment note and "customer" stage. Runs in the
  // background; what was already posted is skipped, so it can run again any time.
  sincronizar(): Sincronizacao {
    if (this.estado.rodando) return this.sincronizacao();
    this.estado = { rodando: true, iniciadaEm: new Date().toISOString(), terminadaEm: null, faturas: 0, notas: 0, pagas: 0, semCliente: 0, erros: [] };
    void this.backfill()
      .catch((e: Error) => {
        this.estado.erros.unshift(e.message);
      })
      .finally(() => {
        this.estado.rodando = false;
        this.estado.terminadaEm = new Date().toISOString();
        this.log(ErrorLevelsEnum.Values.INFO, "linha do tempo sincronizada", { ...this.estado, erros: this.estado.erros.length });
      });
    return this.sincronizacao();
  }

  private async backfill(): Promise<void> {
    let pagina: string | null = null;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const lida = await this.billing.todas(pagina);
      if (lida.isLeft()) throw lida.value;
      const faturas = lida.value.faturas.filter((f) => f.status !== "draft" && f.status !== "void");
      this.estado.faturas += faturas.length;
      await this.backfillPagina(faturas);
      pagina = lida.value.proxima;
      if (!pagina) return;
    }
  }

  private async backfillPagina(faturas: FaturaRecente[]): Promise<void> {
    const ids = [...new Set(faturas.map((f) => f.hubspotId).filter((id): id is string => !!id && /^\d+$/.test(id)))];
    const contatos = ids.length ? await this.hubspot.readContacts(ids) : null;
    if (contatos?.isLeft()) throw contatos.value;
    const porId = new Map<string, HubspotContact>((contatos?.isRight() ? contatos.value : []).map((c) => [c.id, c]));
    const feitas = await this.envios.existentes(faturas.flatMap((f) => [`nota:fatura:${f.id}`, `nota:pago:${f.id}`]));

    for (const f of faturas) {
      const contato = f.hubspotId ? porId.get(f.hubspotId) : undefined;
      if (!contato) {
        this.estado.semCliente += 1;
        continue;
      }
      if (!feitas.has(`nota:fatura:${f.id}`)) {
        const avisos = await this.emitida(
          {
            faturaId: f.id,
            numero: f.numero,
            descricao: f.descricao ?? "Cobrança",
            valorCentavos: f.valorCentavos,
            vencimento: f.vencimento,
            url: f.url,
            emissor: f.emissor ?? "Sample ERP",
            email: f.clienteEmail ?? contato.properties.email ?? "",
            quando: f.criadaEm,
            ...contatoDaCobranca(contato),
          },
          { whatsapp: false },
        );
        if (avisos.notaNoHubspot) this.estado.notas += 1;
        this.estado.erros.push(...avisos.erros.map((e) => `${f.numero ?? f.id}: ${e}`));
      }
      if (f.status === "paid" && !feitas.has(`nota:pago:${f.id}`)) {
        const erros = await this.paga({ faturaId: f.id, numero: f.numero, valorCentavos: f.pagoCentavos || f.valorCentavos, email: f.clienteEmail, contatoId: contato.id, quando: f.pagaEm ?? null });
        if (erros.length === 0) this.estado.pagas += 1;
        this.estado.erros.push(...erros.map((e) => `${f.numero ?? f.id}: ${e}`));
      }
    }
  }

  // true when posted now or before; throws with the reason otherwise
  private async nota(chave: string, corpo: string, quando: string | null | undefined, contatoId: string, empresaId: string | null): Promise<true> {
    return this.unicaVez(chave, "hubspot", async () => {
      const criada = await this.hubspot.createActivity(
        "notes",
        { hs_note_body: corpo, hs_timestamp: new Date(quando ?? Date.now()).toISOString() },
        { contatos: [contatoId], empresas: empresaId ? [empresaId] : [] },
      );
      if (criada.isLeft()) throw criada.value;
      return criada.value.id;
    }).then(() => true as const);
  }

  private async enviarWhatsapp(c: CobrancaEmitida): Promise<WhatsappStatus> {
    if (!this.whatsapp.configurado) return "desligado";
    const para = numeroWhatsapp(c.telefone);
    if (!para) return "sem_telefone";
    const texto = cobrancaClienteEmail({ email: c.email, nome: c.nome, descricao: c.descricao, valorCentavos: c.valorCentavos, vencimento: c.vencimento, numero: c.numero, url: c.url!, emissor: c.emissor }).text;
    const enviado = await this.unicaVez(`whatsapp:fatura:${c.faturaId}`, "whatsapp", async () => {
      const r = await this.whatsapp.enviar(para, texto, [c.nome, c.emissor, c.numero ?? "—", c.descricao, reais(c.valorCentavos), dia(c.vencimento), c.url!]);
      if (r.isLeft()) throw r.value;
      return r.value;
    });
    return enviado ? "enviado" : "ja_enviado";
  }

  // runs `enviar` only if this key was never sent; false when it already was
  private async unicaVez(chave: string, canal: Canal, enviar: () => Promise<string>): Promise<boolean> {
    if (!(await this.envios.reservar(chave, canal))) return false;
    try {
      await this.envios.confirmar(chave, await enviar());
      return true;
    } catch (error) {
      await this.envios.liberar(chave).catch(() => undefined);
      throw error;
    }
  }

  private log(level: (typeof ErrorLevelsEnum.Values)[keyof typeof ErrorLevelsEnum.Values], message: string, context: Record<string, unknown>) {
    this.logger.handle({ layer: "service", service: "AvisosDeCobrancaService", ...context }, level, message);
  }
}

const notaDeEmissao = (c: CobrancaEmitida) => `<p><strong>${c.recorrente ? "Pagamento mensal: cobrança emitida" : "Cobrança emitida"}</strong>${
  c.numero ? ` — fatura ${escapeHtml(c.numero)}` : ""
}</p>
<p>${escapeHtml(c.descricao)}</p>
<p>${escapeHtml(reais(c.valorCentavos))} · vencimento em ${escapeHtml(dia(c.vencimento))}</p>
<p>Emitida por ${escapeHtml(c.emissor)} no Sample ERP${c.url ? ` · <a href="${escapeHtml(c.url)}">link de pagamento</a>` : ""}.</p>`;

export default AvisosDeCobrancaService;
