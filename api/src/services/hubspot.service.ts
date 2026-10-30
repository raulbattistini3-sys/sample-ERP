import { z } from "zod";
import IntegracaoRepository, { IntegracaoRow } from "../repositories/integracao.repository";
import IntegracaoService from "./integracao.service";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import type { QueuedEnvio } from "../repositories/integracao_envios.repository";
import { buildAuditoriaIssue } from "./auditoria_issue_content";

// HubSpot tickets: one per (auditoria, categoria). Paths are the date-versioned CRM APIs
// (https://developers.hubspot.com/docs/api-reference/latest/crm/objects/tickets/guide).
const API_VERSION = "2026-09";
const TICKETS = `/crm/objects/${API_VERSION}/tickets`;
const PIPELINES = `/crm/pipelines/${API_VERSION}/tickets`;
const CONTACTS = `/crm/objects/${API_VERSION}/contacts`;
const COMPANIES = `/crm/objects/${API_VERSION}/companies`;
const CONTACT_PROPERTIES =
  "firstname,lastname,email,phone,company,lifecyclestage,createdate,lastmodifieddate,jobtitle,hs_seniority,hs_buying_role";
const COMPANY_PROPERTIES = "name,domain,industry";
const PER_PAGE = 100;
// tickets are the CRM object type 0-5
const ticketUrl = (hubId: unknown, id: string) => `https://app.hubspot.com/contacts/${hubId}/record/0-5/${id}`;

export type HubspotConfig = { pipelineId: string; pipelineName: string; stageId: string; stageName: string };
type HubspotRecord = { id: string; url?: string; properties: Record<string, string | null | undefined> };
export type HubspotCompany = HubspotRecord;
// a contact linked to a company comes with one entry per association type, so an id can repeat
export type HubspotContact = HubspotRecord & { associations?: { companies?: { results?: { id: string }[] } } };
type HubspotPage<T> = { results?: T[]; paging?: { next?: { after?: string } } };
type Pipeline = { id: string; label: string; stages: { id: string; label: string }[] };

const ConfigSchema = z.object({
  pipelineId: z.string({ required_error: "Escolha um pipeline." }).trim().min(1, "Escolha um pipeline."),
  stageId: z.string({ required_error: "Escolha um status." }).trim().min(1, "Escolha um status."),
});

const notConnected = () => new ValidationError("409", "O HubSpot não está conectado. Conecte em Integrações.");
const notConfigured = () => new ValidationError("409", "Escolha o pipeline e o status do HubSpot em Integrações.");
const reconnect = () =>
  new ValidationError("409", "A conexão com o HubSpot expirou ou foi revogada. Conecte novamente em Integrações.");
const failed = (cause?: unknown) =>
  new ServerError("503", true, "O HubSpot está indisponível ou limitou as requisições. Tente novamente.", cause);

class HubspotService {
  constructor(
    private readonly repository: IntegracaoRepository,
    private readonly integracoes: IntegracaoService,
    private readonly options: { apiUrl: string },
  ) {}

  async listPipelines(): Promise<Either<BaseAppError, Pipeline[]>> {
    const list = await this.request(PIPELINES);
    if (list.isLeft()) return left(list.value);
    const pipelines = ((list.value as { results?: { id: string; label: string }[] }).results ?? []);
    const stages = await Promise.all(pipelines.map(({ id }) => this.request(`${PIPELINES}/${encodeURIComponent(id)}/stages`)));
    const result: Pipeline[] = [];
    for (const [index, { id, label }] of pipelines.entries()) {
      const response = stages[index];
      if (response.isLeft()) return left(response.value);
      const found = (response.value as { results?: { id: string; label: string }[] }).results ?? [];
      result.push({ id, label, stages: found.map((s) => ({ id: s.id, label: s.label })) });
    }
    return right(result);
  }

  // confirms against HubSpot that the pipeline exists and has that status
  async saveConfig(payload: unknown): Promise<Either<BaseAppError, HubspotConfig>> {
    const parsed = ConfigSchema.safeParse(payload);
    if (!parsed.success) return left(new ValidationError("400", parsed.error.errors.map((e) => e.message).join(", ")));
    const pipelines = await this.listPipelines();
    if (pipelines.isLeft()) return left(pipelines.value);
    const pipeline = pipelines.value.find((p) => p.id === parsed.data.pipelineId);
    if (!pipeline) return left(new ValidationError("400", "Pipeline não encontrado no HubSpot"));
    const stage = pipeline.stages.find((s) => s.id === parsed.data.stageId);
    if (!stage) return left(new ValidationError("400", "Esse status não existe nesse pipeline"));
    const config = { pipelineId: pipeline.id, pipelineName: pipeline.label, stageId: stage.id, stageName: stage.label };
    await this.repository.updateConfig("hubspot", config);
    return right(config);
  }

  async createTestTicket(usuarioNome: string): Promise<Either<BaseAppError, { key: string; url: string }>> {
    return this.createTicket("Teste de integração — ERP Estoque", [
      `Ticket de teste criado por ${usuarioNome} em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
      "A conexão entre o ERP Estoque e o HubSpot está funcionando. Este ticket pode ser apagado.",
    ]);
  }

  async createAuditoriaTicket(envio: QueuedEnvio): Promise<Either<BaseAppError, { key: string; url: string }>> {
    const { summary, paragraphs } = buildAuditoriaIssue(envio);
    return this.createTicket(summary, paragraphs);
  }

  listContacts(after?: string) {
    return this.page<HubspotContact>(CONTACTS, { properties: CONTACT_PROPERTIES, associations: "companies" }, after);
  }

  listCompanies(after?: string) {
    return this.page<HubspotCompany>(COMPANIES, { properties: COMPANY_PROPERTIES }, after);
  }

  // one page of records; after is the cursor of the next one, undefined on the last
  private async page<T>(path: string, params: Record<string, string>, after?: string): Promise<Either<BaseAppError, { results: T[]; after?: string }>> {
    const query = new URLSearchParams({ limit: String(PER_PAGE), ...params, ...(after && { after }) });
    const response = await this.request(`${path}?${query}`);
    if (response.isLeft()) return left(response.value);
    const body = response.value as HubspotPage<T>;
    return right({ results: body.results ?? [], after: body.paging?.next?.after });
  }

  private async createTicket(subject: string, paragraphs: string[]): Promise<Either<BaseAppError, { key: string; url: string }>> {
    const row = await this.repository.find("hubspot");
    if (!row) return left(notConnected());
    const { pipelineId, stageId } = row.config as Partial<HubspotConfig>;
    if (!pipelineId || !stageId) return left(notConfigured());
    const response = await this.request(TICKETS, {
      method: "POST",
      body: JSON.stringify({
        properties: {
          subject: subject.slice(0, 255),
          content: paragraphs.join("\n"),
          hs_pipeline: pipelineId,
          hs_pipeline_stage: stageId,
        },
      }),
    });
    if (response.isLeft()) return left(response.value);
    const { id } = response.value as { id: string };
    return right({ key: id, url: ticketUrl(row.contaExterna.hubId, id) });
  }

  private async request(path: string, init: RequestInit = {}): Promise<Either<BaseAppError, unknown>> {
    const row: IntegracaoRow | null = await this.repository.find("hubspot");
    if (!row) return left(notConnected());
    try {
      const response = await this.integracoes.authorizedFetch(row, `${this.options.apiUrl}${path}`, init);
      if (!response) return left(reconnect());
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) {
        return left(new ValidationError("409", "O app do HubSpot não tem os escopos necessários. Conecte novamente em Integrações."));
      }
      if (response.status === 400) {
        const message = (body as { message?: string }).message;
        return left(new ValidationError("400", message ? `HubSpot: ${message}` : "O HubSpot recusou o pedido."));
      }
      if (!response.ok) return left(failed({ status: response.status }));
      return right(body);
    } catch (error) {
      return left(failed(error));
    }
  }
}

export default HubspotService;
