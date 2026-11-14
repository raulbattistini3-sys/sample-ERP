import HubspotService, { Atividade, Estagio, Owner } from "./hubspot.service";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import { escapeHtml } from "../utils/mailer/password_reset_email.util";
import AtividadeValidator from "../validators/atividade.validator";

// Shortcuts on Clientes and Empresas: a note, an e-mail or a meeting goes straight to the HubSpot
// timeline of the contact (and its company) or of the company, without leaving the list. The e-mail is
// also really sent, through Resend, to the contact's address.

type Autor = { nome: string; email: string };
export type AtividadeCriada = { id: string; tipo: "nota" | "email" | "reuniao"; emailEnviado: boolean | null; aviso: string | null };

const TIPO_HUBSPOT: Record<"nota" | "email" | "reuniao", Atividade> = { nota: "notes", email: "emails", reuniao: "meetings" };
const paragrafos = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

class AtividadeService {
  private readonly validator = new AtividadeValidator();
  private donos: { em: number; lista: Owner[] } | null = null;

  constructor(
    private readonly hubspot: HubspotService,
    private readonly mailer: MailerInterface,
  ) {}

  async registrar(payload: unknown, autor: Autor): Promise<Either<BaseAppError, AtividadeCriada>> {
    const parsed = this.validator.parseAtividade(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const a = parsed.value;

    // a contact's activity also shows on its company
    let email: string | null = null;
    let empresaId = a.empresaId ?? null;
    if (a.contatoId) {
      const contato = await this.hubspot.readContact(a.contatoId);
      if (contato.isLeft()) return left(contato.value);
      if (!contato.value) return left(new ValidationError("404", "Cliente não encontrado no HubSpot."));
      email = contato.value.properties.email?.trim() || null;
      empresaId ??= contato.value.properties.associatedcompanyid?.trim() || null;
    }
    const ligados = { contatos: a.contatoId ? [a.contatoId] : [], empresas: empresaId ? [empresaId] : [] };
    const agora = new Date().toISOString();

    let properties: Record<string, string>;
    let emailEnviado: boolean | null = null;
    let aviso: string | null = null;
    if (a.tipo === "nota") {
      properties = { hs_timestamp: agora, hs_note_body: `${paragrafos(a.corpo)}<p><em>${escapeHtml(autor.nome)} pelo Sample ERP</em></p>` };
    } else if (a.tipo === "email") {
      if (!email) return left(new ValidationError("400", "O cliente não tem e-mail no HubSpot."));
      const html = paragrafos(a.corpo);
      if (a.enviar) {
        const enviado = await this.mailer.send({ to: email, subject: a.assunto, text: a.corpo, html, cc: [autor.email] });
        if (enviado.isLeft()) return left(enviado.value);
        emailEnviado = true;
        if (enviado.value.semCopias) aviso = "O e-mail foi enviado, mas a cópia para você foi recusada pelo provedor.";
      }
      properties = {
        hs_timestamp: agora,
        hs_email_direction: "EMAIL",
        hs_email_status: "SENT",
        hs_email_subject: a.assunto,
        hs_email_text: a.corpo,
        hs_email_html: html,
        hs_email_headers: JSON.stringify({ from: { email: autor.email, firstName: autor.nome }, to: [{ email }], cc: [], bcc: [] }),
      };
    } else {
      const inicio = new Date(a.inicio);
      properties = {
        hs_timestamp: inicio.toISOString(),
        hs_meeting_title: a.titulo,
        hs_meeting_body: a.descricao,
        hs_internal_meeting_notes: `Agendada por ${autor.nome} pelo Sample ERP`,
        hs_meeting_location: a.local,
        hs_meeting_start_time: inicio.toISOString(),
        hs_meeting_end_time: new Date(inicio.getTime() + a.duracaoMinutos * 60_000).toISOString(),
        hs_meeting_outcome: inicio.getTime() > Date.now() ? "SCHEDULED" : "COMPLETED",
      };
    }

    const criada = await this.hubspot.createActivity(TIPO_HUBSPOT[a.tipo], properties, ligados);
    if (criada.isLeft()) {
      // the e-mail already went: say so instead of a plain error, so nobody sends it again
      if (emailEnviado) return right({ id: "", tipo: a.tipo, emailEnviado, aviso: `O e-mail foi enviado, mas não foi registrado no HubSpot: ${criada.value.message}` });
      return left(criada.value);
    }
    return right({ id: criada.value.id, tipo: a.tipo, emailEnviado, aviso });
  }

  // HubSpot users, cached for 5 minutes (they change rarely and every Empresa page asks)
  async responsaveis(): Promise<Either<BaseAppError, Owner[]>> {
    if (this.donos && Date.now() - this.donos.em < 5 * 60_000) return right(this.donos.lista);
    const lidos = await this.hubspot.owners();
    if (lidos.isRight()) this.donos = { em: Date.now(), lista: lidos.value };
    return lidos;
  }

  // Funil: the companies of one stage, newest change first
  funil(estagio: string, after: string | null, busca: string, limite = 25) {
    const parsed = this.validator.parseEstagio({ estagio });
    if (parsed.isLeft()) return Promise.resolve(left<BaseAppError, never>(parsed.value));
    return this.hubspot.companiesByStage(parsed.value.estagio as Estagio, after ?? undefined, Math.min(100, Math.max(1, Math.trunc(limite))), busca);
  }

  async moverEmpresa(id: string, payload: unknown): Promise<Either<BaseAppError, null>> {
    const idValido = this.validator.validateHubspotId(id, "empresa");
    if (idValido.isLeft()) return left(idValido.value);
    const parsed = this.validator.parseEstagio(payload);
    if (parsed.isLeft()) return left(parsed.value);
    return this.hubspot.setLifecycleStage("companies", id, parsed.value.estagio as Estagio);
  }
}

export default AtividadeService;
