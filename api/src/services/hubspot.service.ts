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
const ASSOCIATIONS = `/crm/associations/${API_VERSION}`;
const CONTACT_PROPERTIES = [
  "firstname", "lastname", "email", "phone", "mobilephone", "company", "lifecyclestage", "jobtitle", "hs_seniority", "hs_buying_role", "associatedcompanyid",
];
const COMPANY_PROPERTIES = [
  "name", "domain", "industry", "phone", "city", "state", "country", "website", "description", "lifecyclestage", "hubspot_owner_id",
];
const OWNERS = `/crm/owners/${API_VERSION}`;
// HubSpot's lifecycle stages, in order. The board (Funil) shows companies by these; "Não contatado" is a
// company with none (or subscriber/other), "Cliente" takes evangelists too.
export const ESTAGIOS = ["nao_contatado", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"] as const;
export type Estagio = (typeof ESTAGIOS)[number];
// HubSpot's lifecyclestage as a Funil column: subscriber/other/empty are "não contatado", evangelist is a customer
export const estagioDe = (lifecyclestage: string | null | undefined): Estagio =>
  lifecyclestage === "evangelist" ? "customer" : (ESTAGIOS as readonly string[]).includes(lifecyclestage ?? "") && lifecyclestage !== "nao_contatado" ? (lifecyclestage as Estagio) : "nao_contatado";
const FILTRO_DO_ESTAGIO: Record<Estagio, object[]> = {
  nao_contatado: [
    { filters: [{ propertyName: "lifecyclestage", operator: "NOT_HAS_PROPERTY" }] },
    { filters: [{ propertyName: "lifecyclestage", operator: "IN", values: ["subscriber", "other"] }] },
  ],
  lead: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "lead" }] }],
  marketingqualifiedlead: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "marketingqualifiedlead" }] }],
  salesqualifiedlead: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "salesqualifiedlead" }] }],
  opportunity: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "opportunity" }] }],
  customer: [{ filters: [{ propertyName: "lifecyclestage", operator: "IN", values: ["customer", "evangelist"] }] }],
};
// notes, e-mails and meetings logged on the record's timeline, and their HUBSPOT_DEFINED association types
export type Atividade = "notes" | "emails" | "meetings";
const ASSOCIACAO_DA_ATIVIDADE: Record<Atividade, { contacts: number; companies: number }> = {
  notes: { contacts: 202, companies: 190 },
  emails: { contacts: 198, companies: 186 },
  meetings: { contacts: 200, companies: 188 },
};
export type Owner = { id: string; nome: string; email: string | null };
const DECISOR = "DECISION_MAKER";
// contact → company, the "Primary" label: it is what sets the contact's associatedcompanyid, so the contact
// shows under the company and stops counting as one without a company
const EMPRESA_PRINCIPAL = [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }];
const SEARCH_PAGE = 200; // the most a search returns at once
const BATCH_SIZE = 100;
// HubSpot's search can't page past this many results
export const SEARCH_LIMIT = 10_000;
// tickets are the CRM object type 0-5
const ticketUrl = (hubId: unknown, id: string) => `https://app.hubspot.com/contacts/${hubId}/record/0-5/${id}`;

export type HubspotConfig = { pipelineId: string; pipelineName: string; stageId: string; stageName: string };
type HubspotRecord = { id: string; url?: string; properties: Record<string, string | null | undefined> };
export type HubspotCompany = HubspotRecord;
export type HubspotContact = HubspotRecord;
type HubspotSearch<T> = { total?: number; results?: T[]; paging?: { next?: { after?: string } } };
type SearchBody = { query?: string; limit: number; after?: string; properties?: string[]; sorts?: object[]; filterGroups?: object[] };
type Pipeline = { id: string; label: string; stages: { id: string; label: string }[] };

// the contact fields the ERP writes; hs_seniority is not among them (the ERP keeps its own senioridade)
export type ContactWrite = Partial<Record<"firstname" | "lastname" | "email" | "phone" | "company" | "jobtitle" | "hs_buying_role", string | null>>;
export type CompanyWrite = Partial<
  Record<"name" | "domain" | "industry" | "phone" | "city" | "state" | "country" | "website" | "description" | "hubspot_owner_id", string | null>
>;
export type IndustryOption = { value: string; label: string };

// create: leave out what's empty; update: "" clears the property in HubSpot
const clean = (properties: ContactWrite | CompanyWrite, clearing = false) =>
  Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined && (clearing || (value !== null && value !== "")))
      .map(([key, value]) => [key, value ?? ""]),
  );

const ConfigSchema = z.object({
  pipelineId: z.string({ required_error: "Escolha um pipeline." }).trim().min(1, "Escolha um pipeline."),
  stageId: z.string({ required_error: "Escolha um status." }).trim().min(1, "Escolha um status."),
});

const chunks = (ids: string[]) =>
  Array.from({ length: Math.ceil(ids.length / BATCH_SIZE) }, (_, index) => ids.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));

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
    private readonly options: { apiUrl: string; serviceKey?: string },
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

  searchContacts(page: number, amount: number, busca: string) {
    return this.searchPage<HubspotContact>(CONTACTS, page, amount, busca, CONTACT_PROPERTIES, "firstname");
  }

  searchCompanies(page: number, amount: number, busca: string) {
    return this.searchPage<HubspotCompany>(COMPANIES, page, amount, busca, COMPANY_PROPERTIES, "name");
  }

  async countContactsWithoutCompany(): Promise<Either<BaseAppError, number>> {
    const response = await this.search<HubspotContact>(CONTACTS, {
      limit: 1,
      filterGroups: [{ filters: [{ propertyName: "associatedcompanyid", operator: "NOT_HAS_PROPERTY" }] }],
    });
    return response.isLeft() ? left(response.value) : right(response.value.total ?? 0);
  }

  // search has no join, so finding the companies of the decision makers starts from the contacts
  async decisionMakerIds(): Promise<Either<BaseAppError, string[]>> {
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const response = await this.search<HubspotContact>(CONTACTS, {
        limit: SEARCH_PAGE,
        after,
        filterGroups: [{ filters: [{ propertyName: "hs_buying_role", operator: "CONTAINS_TOKEN", value: DECISOR }] }],
      });
      if (response.isLeft()) return left(response.value);
      ids.push(...(response.value.results ?? []).map(({ id }) => id));
      after = response.value.paging?.next?.after;
    } while (after && ids.length < SEARCH_LIMIT);
    return right(ids);
  }

  // ERP → HubSpot: the Clientes form creates and edits the contact in HubSpot itself, so HubSpot stays
  // the one place contacts live. Needs the crm.objects.contacts.write scope.
  async createContact(properties: ContactWrite): Promise<Either<BaseAppError, HubspotContact>> {
    const response = await this.request(CONTACTS, { method: "POST", body: JSON.stringify({ properties: clean(properties) }) });
    return response.isLeft() ? left(response.value) : right(response.value as HubspotContact);
  }

  async updateContact(id: string, properties: ContactWrite): Promise<Either<BaseAppError, HubspotContact>> {
    const response = await this.request(`${CONTACTS}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: clean(properties, true) }),
    });
    return response.isLeft() ? left(response.value) : right(response.value as HubspotContact);
  }

  // by e-mail, for the spreadsheet import: one entry per e-mail found
  readContactsByEmail(emails: string[]) {
    return this.read<HubspotContact>(CONTACTS, emails, CONTACT_PROPERTIES, "email");
  }

  // creates or updates by e-mail, 100 per call: importing the same sheet twice doesn't duplicate anyone
  async upsertContactsByEmail(inputs: { email: string; properties: ContactWrite }[]): Promise<Either<BaseAppError, HubspotContact[]>> {
    const records: HubspotContact[] = [];
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const response = await this.request(`${CONTACTS}/batch/upsert`, {
        method: "POST",
        body: JSON.stringify({
          inputs: inputs.slice(i, i + BATCH_SIZE).map(({ email, properties }) => ({ idProperty: "email", id: email, properties: clean(properties) })),
        }),
      });
      if (response.isLeft()) return left(response.value);
      records.push(...((response.value as { results?: HubspotContact[] }).results ?? []));
    }
    return right(records);
  }

  // Needs crm.objects.companies.write.
  async createCompany(properties: CompanyWrite): Promise<Either<BaseAppError, HubspotCompany>> {
    const response = await this.request(COMPANIES, { method: "POST", body: JSON.stringify({ properties: clean(properties) }) });
    return response.isLeft() ? left(response.value) : right(response.value as HubspotCompany);
  }

  async updateCompany(id: string, properties: CompanyWrite): Promise<Either<BaseAppError, HubspotCompany>> {
    const response = await this.request(`${COMPANIES}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: clean(properties, true) }),
    });
    return response.isLeft() ? left(response.value) : right(response.value as HubspotCompany);
  }

  async readCompany(id: string): Promise<Either<BaseAppError, HubspotCompany | null>> {
    const response = await this.readCompanies([id]);
    return response.isLeft() ? left(response.value) : right(response.value[0] ?? null);
  }

  // the companies with this name (search's EQ ignores case), oldest first
  async findCompaniesByName(name: string): Promise<Either<BaseAppError, HubspotCompany[]>> {
    const response = await this.search<HubspotCompany>(COMPANIES, {
      limit: 10,
      properties: COMPANY_PROPERTIES,
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }],
      sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
    });
    return response.isLeft() ? left(response.value) : right(response.value.results ?? []);
  }

  // HubSpot's own list for industry (the property only takes these values); needs crm.schemas.companies.read
  async industryOptions(): Promise<Either<BaseAppError, IndustryOption[]>> {
    let response = await this.request(`/crm/properties/${API_VERSION}/companies/industry`);
    if (response.isLeft()) response = await this.request("/crm/v3/properties/companies/industry");
    if (response.isLeft()) return left(response.value);
    const { options = [] } = response.value as { options?: { value: string; label: string; hidden?: boolean }[] };
    return right(options.filter((o) => !o.hidden).map(({ value, label }) => ({ value, label })));
  }

  // the companies at one stage of the board, most recently changed first
  async companiesByStage(estagio: Estagio, after: string | undefined, limit: number, busca: string) {
    return this.search<HubspotCompany>(COMPANIES, {
      query: busca || undefined,
      limit,
      after,
      properties: COMPANY_PROPERTIES,
      filterGroups: FILTRO_DO_ESTAGIO[estagio],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    });
  }

  // HubSpot only lets lifecyclestage move forward; moving it back takes clearing it first. "nao_contatado"
  // clears it. Works for contacts and companies.
  async setLifecycleStage(objeto: "contacts" | "companies", id: string, estagio: Estagio): Promise<Either<BaseAppError, null>> {
    const path = `${objeto === "contacts" ? CONTACTS : COMPANIES}/${encodeURIComponent(id)}`;
    const patch = (valor: string) =>
      this.request(path, { method: "PATCH", body: JSON.stringify({ properties: { lifecyclestage: valor } }) });
    if (estagio === "nao_contatado") {
      const limpo = await patch("");
      return limpo.isLeft() ? left(limpo.value) : right(null);
    }
    let response = await patch(estagio);
    if (response.isLeft() && response.value.statusCode === "400") {
      const limpo = await patch("");
      if (limpo.isLeft()) return left(limpo.value);
      response = await patch(estagio);
    }
    return response.isLeft() ? left(response.value) : right(null);
  }

  // the HubSpot users a company can be assigned to; needs crm.objects.owners.read
  async owners(): Promise<Either<BaseAppError, Owner[]>> {
    const owners: Owner[] = [];
    let after: string | undefined;
    do {
      const query = `?limit=100&archived=false${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      let response = await this.request(`${OWNERS}${query}`);
      if (response.isLeft() && response.value.statusCode === "404") response = await this.request(`/crm/v3/owners${query}`);
      if (response.isLeft()) return left(response.value);
      const page = response.value as { results?: { id: string; email?: string; firstName?: string; lastName?: string }[]; paging?: { next?: { after?: string } } };
      for (const o of page.results ?? []) {
        owners.push({ id: String(o.id), nome: [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || `Usuário ${o.id}`, email: o.email ?? null });
      }
      after = page.paging?.next?.after;
    } while (after);
    return right(owners.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
  }

  // a note, e-mail or meeting on the timeline of these contacts and companies
  async createActivity(
    tipo: Atividade,
    properties: Record<string, string>,
    ligados: { contatos?: string[]; empresas?: string[] },
  ): Promise<Either<BaseAppError, { id: string }>> {
    const tipos = ASSOCIACAO_DA_ATIVIDADE[tipo];
    const para = (ids: string[] = [], associationTypeId: number) =>
      [...new Set(ids)].map((id) => ({ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId }] }));
    const response = await this.request(`/crm/objects/${API_VERSION}/${tipo}`, {
      method: "POST",
      body: JSON.stringify({
        properties,
        associations: [...para(ligados.contatos, tipos.contacts), ...para(ligados.empresas, tipos.companies)],
      }),
    });
    return response.isLeft() ? left(response.value) : right({ id: (response.value as { id: string }).id });
  }

  // makes each company the contact's primary one
  async linkContactsToCompanies(pairs: { contactId: string; companyId: string }[]): Promise<Either<BaseAppError, null>> {
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const response = await this.request(`${ASSOCIATIONS}/contacts/companies/batch/create`, {
        method: "POST",
        body: JSON.stringify({
          inputs: pairs.slice(i, i + BATCH_SIZE).map(({ contactId, companyId }) => ({ from: { id: contactId }, to: { id: companyId }, types: EMPRESA_PRINCIPAL })),
        }),
      });
      if (response.isLeft()) return left(response.value);
    }
    return right(null);
  }

  // removes every link (any label) between the contact and these companies
  async unlinkContactFromCompanies(contactId: string, companyIds: string[]): Promise<Either<BaseAppError, null>> {
    if (companyIds.length === 0) return right(null);
    const response = await this.request(`${ASSOCIATIONS}/contacts/companies/batch/archive`, {
      method: "POST",
      body: JSON.stringify({ inputs: [{ from: { id: contactId }, to: companyIds.map((id) => ({ id })) }] }),
    });
    return response.isLeft() ? left(response.value) : right(null);
  }

  async readContact(id: string): Promise<Either<BaseAppError, HubspotContact | null>> {
    const response = await this.readContacts([id]);
    return response.isLeft() ? left(response.value) : right(response.value[0] ?? null);
  }

  readContacts(ids: string[]) {
    return this.read<HubspotContact>(CONTACTS, ids, CONTACT_PROPERTIES);
  }

  readCompanies(ids: string[]) {
    return this.read<HubspotCompany>(COMPANIES, ids, COMPANY_PROPERTIES);
  }

  // the ids linked to each record; one with no links is left out of the map
  async associated(from: "companies" | "contacts", to: "companies" | "contacts", ids: string[]): Promise<Either<BaseAppError, Map<string, string[]>>> {
    const found = new Map<string, string[]>();
    for (const inputs of chunks(ids)) {
      const response = await this.request(`${ASSOCIATIONS}/${from}/${to}/batch/read`, {
        method: "POST",
        body: JSON.stringify({ inputs: inputs.map((id) => ({ id })) }),
      });
      if (response.isLeft()) return left(response.value);
      const { results = [] } = response.value as { results?: { from: { id: string }; to?: { toObjectId: number }[] }[] };
      // one entry per association type, so an id can repeat
      for (const { from: { id }, to: links = [] } of results) found.set(id, [...new Set(links.map((link) => String(link.toObjectId)))]);
    }
    return right(found);
  }

  private searchPage<T>(path: string, page: number, amount: number, busca: string, properties: string[], sortBy: string) {
    return this.search<T>(path, {
      query: busca || undefined,
      limit: amount,
      after: page > 1 ? String((page - 1) * amount) : undefined,
      properties,
      sorts: [{ propertyName: sortBy, direction: "ASCENDING" }],
    });
  }

  private async search<T>(path: string, body: SearchBody): Promise<Either<BaseAppError, HubspotSearch<T>>> {
    const response = await this.request(`${path}/search`, { method: "POST", body: JSON.stringify(body) });
    return response.isLeft() ? left(response.value) : right(response.value as HubspotSearch<T>);
  }

  private async read<T>(path: string, ids: string[], properties: string[], idProperty?: string): Promise<Either<BaseAppError, T[]>> {
    const records: T[] = [];
    for (const inputs of chunks(ids)) {
      const response = await this.request(`${path}/batch/read`, {
        method: "POST",
        body: JSON.stringify({ properties, idProperty, inputs: inputs.map((id) => ({ id })) }),
      });
      if (response.isLeft()) return left(response.value);
      records.push(...((response.value as { results?: T[] }).results ?? []));
    }
    return right(records);
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

  // a service key is a fixed token: no connection row, nothing to refresh
  private withServiceKey(key: string, url: string, init: RequestInit) {
    return fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${key}`,
      },
    });
  }

  private async request(path: string, init: RequestInit = {}): Promise<Either<BaseAppError, unknown>> {
    const { apiUrl, serviceKey } = this.options;
    const row: IntegracaoRow | null = serviceKey ? null : await this.repository.find("hubspot");
    if (!serviceKey && !row) return left(notConnected());
    try {
      const response = serviceKey
        ? await this.withServiceKey(serviceKey, `${apiUrl}${path}`, init)
        : await this.integracoes.authorizedFetch(row!, `${apiUrl}${path}`, init);
      if (!response) return left(reconnect());
      const body = await response.json().catch(() => ({}));
      if (serviceKey && (response.status === 401 || response.status === 403)) {
        return left(new ValidationError("409", "A chave de serviço do HubSpot é inválida ou não tem os escopos necessários."));
      }
      if (response.status === 403) {
        return left(new ValidationError("409", "O app do HubSpot não tem os escopos necessários. Conecte novamente em Integrações."));
      }
      if (response.status === 404) return left(new ValidationError("404", "Registro não encontrado no HubSpot."));
      if (response.status === 409) {
        // "Contact already exists. Existing ID: 123"
        const message = (body as { message?: string }).message ?? "";
        const existente = /Existing ID:\s*(\d+)/i.exec(message)?.[1];
        return left(new ValidationError("409", existente ? `Já existe um contato com esse e-mail no HubSpot (id ${existente}).` : "Esse contato já existe no HubSpot."));
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
