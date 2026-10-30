import "dotenv/config";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { Provider } from "../configs/oauth.providers";
import IntegracaoRepository, { IntegracaoRow, TokenSet } from "../repositories/integracao.repository";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { decryptSecret, encryptionConfigured, encryptSecret } from "../utils/helpers/crypto.util";
import { mondayRequest } from "../integrations/monday/monday.client";
import { MeQuery } from "../integrations/monday/monday.operations";

export type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  scopes: string;
  extraParams: Readonly<Record<string, string>>;
};

export type IntegracaoOptions = {
  webUrl: string; // where the browser lands after the provider's consent screen
  callbackBaseUrl: string; // this API's public address; the provider redirects to <it>/integracoes/<provider>/callback
  atlassianApiUrl: string; // https://api.atlassian.com
  mondayApiUrl: string; // https://api.monday.com/v2
  fetch: typeof fetch;
};

export type IntegracaoStatus = {
  provider: Provider;
  nome: string;
  configurado: boolean; // client id/secret and the encryption key are set on the server
  conectado: boolean;
  conta?: Record<string, unknown>;
  config?: Record<string, unknown>;
  conectadoPor?: string | null;
  conectadoEm?: string;
};

// only providers with an adapter here can be connected; monday's OAuth config is ready for when it gets one
const SUPPORTED: Record<string, string> = { jira: "Jira (Atlassian)", monday: "monday.com" };
const STATE_TTL_MINUTES = 10;
const REFRESH_MARGIN_SECONDS = 60;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const JiraConfigSchema = z.object({
  projectKey: z.string({ required_error: "Escolha um projeto." }).trim().min(1, "Escolha um projeto."),
  issueTypeId: z.string({ required_error: "Escolha um tipo de issue." }).trim().min(1, "Escolha um tipo de issue."),
});

const notConnected = () => new ValidationError("409", "O Jira não está conectado. Conecte em Integrações.");
const reconnect = () =>
  new ValidationError("409", "A conexão com o Jira expirou ou foi revogada. Conecte novamente em Integrações.");
const jiraFailed = (cause?: unknown) => new ServerError("503", true, "O Jira não respondeu como esperado. Tente novamente.", cause);

// Atlassian Document Format: the issue description body
const adfParagraphs = (...lines: string[]) => ({
  type: "doc",
  version: 1,
  content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

class IntegracaoService {
  constructor(
    private readonly repository: IntegracaoRepository,
    private readonly providers: Record<Provider, ProviderConfig>,
    private readonly logger: LoggerInterface,
    private readonly options: IntegracaoOptions,
  ) {}

  private isSupported(provider: string): provider is Provider {
    return provider in SUPPORTED && provider in this.providers;
  }

  private isConfigured(provider: Provider) {
    const config = this.providers[provider];
    return !!config.clientId && !!config.clientSecret && encryptionConfigured();
  }

  private redirectUri(provider: Provider) {
    return `${this.options.callbackBaseUrl}/integracoes/${provider}/callback`;
  }

  async list(): Promise<IntegracaoStatus[]> {
    const rows = new Map((await this.repository.list()).map((row) => [row.provider, row]));
    return Object.entries(SUPPORTED).map(([provider, nome]) => {
      const row = rows.get(provider as Provider);
      return {
        provider: provider as Provider,
        nome,
        configurado: this.isConfigured(provider as Provider),
        conectado: !!row,
        ...(row && {
          conta: row.contaExterna,
          config: row.config,
          conectadoPor: row.conectadoPorNome,
          conectadoEm: new Date(row.conectadoEm).toISOString(),
        }),
      };
    });
  }

  // step 1: the consent URL the browser opens. `state` ties the callback to this usuario and request
  async authorizeUrl(provider: string, usuarioId: string): Promise<Either<BaseAppError, { url: string }>> {
    if (!this.isSupported(provider)) {
      return left(new ValidationError("404", "Integração não encontrada"));
    }
    if (!this.isConfigured(provider)) {
      return left(new ServerError("501", true, `A integração ${SUPPORTED[provider]} não está configurada no servidor.`));
    }
    const config = this.providers[provider];
    const state = randomBytes(32).toString("base64url");
    await this.repository.saveState(provider, sha256(state), usuarioId, STATE_TTL_MINUTES);

    const url = new URL(config.authorizeUrl);
    for (const [key, value] of Object.entries(config.extraParams)) url.searchParams.set(key, value);
    url.searchParams.set("client_id", config.clientId!);
    url.searchParams.set("scope", config.scopes);
    url.searchParams.set("redirect_uri", this.redirectUri(provider));
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    return right({ url: url.toString() });
  }

  // step 2: the provider sends the browser back here. Always answers with where to send the browser
  // in the web app, with ?status=conectado or ?erro=<reason>; tokens and codes never reach the web app
  async handleCallback(provider: string, query: Record<string, unknown>): Promise<string> {
    const back = (params: Record<string, string>) => {
      const url = new URL(`${this.options.webUrl}/integracoes`);
      url.searchParams.set("provider", provider);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url.toString();
    };
    if (!this.isSupported(provider) || !this.isConfigured(provider)) return back({ erro: "nao_configurada" });
    if (query.error) return back({ erro: query.error === "access_denied" ? "acesso_negado" : "provedor" });

    const state = typeof query.state === "string" ? query.state : "";
    const code = typeof query.code === "string" ? query.code : "";
    const usuarioId = state ? await this.repository.consumeState(provider, sha256(state)) : null;
    if (!usuarioId || !code) return back({ erro: "estado_invalido" });

    try {
      const token = await this.requestTokens(provider, { grant_type: "authorization_code", code, redirect_uri: this.redirectUri(provider) });
      if (!token) return back({ erro: "troca_de_token" });

      const account = await this.connectedAccount(provider, token.access_token);
      if ("erro" in account) return back({ erro: account.erro });

      await this.repository.upsertConnection({
        provider,
        tokens: this.encryptTokens(token),
        escopos: token.scope ?? this.providers[provider].scopes,
        contaExterna: account.conta,
        contaChave: account.chave,
        conectadoPor: usuarioId,
      });
      return back({ status: "conectado" });
    } catch (error) {
      this.logError("integration callback failed", provider, error);
      return back({ erro: "provedor" });
    }
  }

  async disconnect(provider: string): Promise<Either<BaseAppError, null>> {
    if (!this.isSupported(provider)) return left(new ValidationError("404", "Integração não encontrada"));
    const removed = await this.repository.delete(provider);
    return removed ? right(null) : left(new ValidationError("404", "Esta integração não está conectada"));
  }

  // ---- Jira -----------------------------------------------------------------------------------

  async listJiraProjects(): Promise<Either<BaseAppError, { key: string; name: string; issueTypes: { id: string; name: string }[] }[]>> {
    const response = await this.jiraRequest("/rest/api/3/project/search?expand=issueTypes&maxResults=100&orderBy=name");
    if (response.isLeft()) return left(response.value);
    const body = response.value as { values?: any[] };
    return right(
      (body.values ?? []).map((p) => ({
        key: p.key,
        name: p.name,
        issueTypes: (p.issueTypes ?? []).filter((t: any) => !t.subtask).map((t: any) => ({ id: String(t.id), name: t.name })),
      })),
    );
  }

  async saveJiraConfig(payload: unknown): Promise<Either<BaseAppError, Record<string, unknown>>> {
    const parsed = JiraConfigSchema.safeParse(payload);
    if (!parsed.success) {
      return left(new ValidationError("400", parsed.error.errors.map((e) => e.message).join(", ")));
    }
    // confirm against Jira that the project exists and offers that issue type
    const response = await this.jiraRequest(`/rest/api/3/project/${encodeURIComponent(parsed.data.projectKey)}?expand=issueTypes`);
    if (response.isLeft()) {
      return response.value instanceof ServerError && (response.value.cause as any)?.status === 404
        ? left(new ValidationError("400", "Projeto não encontrado no Jira"))
        : left(response.value);
    }
    const project = response.value as { key: string; name: string; issueTypes?: { id: string; name: string }[] };
    const issueType = project.issueTypes?.find((t) => String(t.id) === parsed.data.issueTypeId);
    if (!issueType) return left(new ValidationError("400", "Esse tipo de issue não existe nesse projeto"));
    const config = { projectKey: project.key, projectName: project.name, issueTypeId: String(issueType.id), issueTypeName: issueType.name };
    await this.repository.updateConfig("jira", config);
    return right(config);
  }

  async createJiraTestIssue(usuarioNome: string): Promise<Either<BaseAppError, { key: string; url: string }>> {
    return this.createJiraIssue({
      summary: "Teste de integração — ERP Estoque",
      paragraphs: [
        `Issue de teste criada por ${usuarioNome} em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
        "A conexão entre o ERP Estoque e o Jira está funcionando. Esta issue pode ser apagada.",
      ],
      labels: ["erp-teste"],
    });
  }

  // An issue in the configured project/issue type. Many projects leave Labels off their create screen,
  // and Jira then rejects the whole issue; in that case it's sent again without labels.
  async createJiraIssue(issue: {
    summary: string;
    paragraphs: string[];
    labels: string[];
  }): Promise<Either<BaseAppError, { key: string; url: string }>> {
    const row = await this.repository.find("jira");
    if (!row) return left(notConnected());
    const { projectKey, issueTypeId } = row.config as { projectKey?: string; issueTypeId?: string };
    if (!projectKey || !issueTypeId) {
      return left(new ValidationError("409", "Escolha o projeto e o tipo de issue do Jira em Integrações."));
    }
    const send = (labels: string[]) =>
      this.jiraRequest("/rest/api/3/issue", {
        method: "POST",
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            issuetype: { id: issueTypeId },
            summary: issue.summary.slice(0, 255),
            description: adfParagraphs(...issue.paragraphs),
            ...(labels.length > 0 && { labels }),
          },
        }),
      });
    let response = await send(issue.labels);
    if (response.isLeft() && issue.labels.length > 0 && response.value.message.includes("labels")) {
      response = await send([]);
    }
    if (response.isLeft()) return left(response.value);
    const { key } = response.value as { key: string };
    return right({ key, url: `${String(row.contaExterna.siteUrl ?? "").replace(/\/$/, "")}/browse/${key}` });
  }

  // GET/POST to the connected Jira site with a valid access token: refreshed first when about to expire,
  // and once more if Jira still answers 401 (e.g. revoked). A refused refresh means: connect again.
  private async jiraRequest(path: string, init: RequestInit = {}): Promise<Either<BaseAppError, unknown>> {
    let row = await this.repository.find("jira");
    if (!row) return left(notConnected());
    try {
      if (row.expiraEm !== null && row.expiraEm <= Date.now() + REFRESH_MARGIN_SECONDS * 1000) {
        row = await this.refreshTokens("jira");
        if (!row) return left(reconnect());
      }
      const call = (current: IntegracaoRow) =>
        this.options.fetch(`${this.options.atlassianApiUrl}/ex/jira/${current.contaExterna.cloudId}${path}`, {
          ...init,
          headers: {
            Accept: "application/json",
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${decryptSecret(current.accessTokenCifrado)}`,
          },
        });
      let response = await call(row);
      if (response.status === 401) {
        row = await this.refreshTokens("jira", true);
        if (!row) return left(reconnect());
        response = await call(row);
      }
      if (response.status === 401) return left(reconnect());
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Jira's own messages are useful to an admin (e.g. a required field in their project)
        const detail = [...((body as any).errorMessages ?? []), ...Object.values((body as any).errors ?? {})].join("; ");
        if (response.status === 400 && detail) return left(new ValidationError("400", `Jira: ${detail}`));
        return left(jiraFailed({ status: response.status }));
      }
      return right(body);
    } catch (error) {
      this.logError("jira request failed", "jira", error);
      return left(jiraFailed(error));
    }
  }

  private async refreshTokens(provider: Provider, force = false): Promise<IntegracaoRow | null> {
    return this.repository.refreshLocked(provider, force ? Number.POSITIVE_INFINITY : REFRESH_MARGIN_SECONDS, async (row) => {
      if (!row.refreshTokenCifrado) return null;
      const token = await this.requestTokens(provider, {
        grant_type: "refresh_token",
        refresh_token: decryptSecret(row.refreshTokenCifrado),
      });
      return token ? this.encryptTokens(token) : null;
    });
  }

  // POST to the provider's token endpoint; null when it refuses (bad code, revoked refresh token...)
  // the account the token belongs to; `chave` identifies it, so reconnecting to the same account keeps the config
  private async connectedAccount(
    provider: Provider,
    accessToken: string,
  ): Promise<{ conta: Record<string, unknown>; chave: string } | { erro: string }> {
    if (provider === "monday") {
      const { me } = await mondayRequest({ apiUrl: this.options.mondayApiUrl, token: accessToken, fetch: this.options.fetch }, MeQuery, {});
      if (!me) return { erro: "provedor" };
      return {
        conta: { accountId: me.account.id, accountName: me.account.name, accountSlug: me.account.slug, userName: me.name, siteUrl: `https://${me.account.slug}.monday.com` },
        chave: "accountId",
      };
    }
    // Jira: which site(s) the user granted; the API calls go to api.atlassian.com/ex/jira/<cloudId>
    const sites = await this.jiraAccessibleResources(accessToken);
    if (!sites) return { erro: "provedor" };
    const site = sites.find((s) => s.scopes?.includes("write:jira-work")) ?? sites[0];
    if (!site) return { erro: "sem_site" };
    return { conta: { cloudId: site.id, siteName: site.name, siteUrl: site.url, sites: sites.length }, chave: "cloudId" };
  }

  // Atlassian takes JSON with grant_type; monday takes a form post of client_id, client_secret, code and
  // redirect_uri (its tokens don't expire, so there is no refresh grant)
  private async requestTokens(provider: Provider, params: Record<string, string>) {
    const config = this.providers[provider];
    const credentials = { client_id: config.clientId ?? "", client_secret: config.clientSecret ?? "" };
    const { grant_type, ...withoutGrant } = params;
    const response = await this.options.fetch(config.tokenUrl, {
      method: "POST",
      headers:
        provider === "monday"
          ? { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
          : { "Content-Type": "application/json", Accept: "application/json" },
      body:
        provider === "monday"
          ? new URLSearchParams({ ...withoutGrant, ...credentials }).toString()
          : JSON.stringify({ grant_type, ...withoutGrant, ...credentials }),
    });
    if (!response.ok) {
      this.logError("token request refused", provider, { status: response.status, grantType: params.grant_type });
      return null;
    }
    return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  }

  private async jiraAccessibleResources(accessToken: string) {
    const response = await this.options.fetch(`${this.options.atlassianApiUrl}/oauth/token/accessible-resources`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as { id: string; name: string; url: string; scopes?: string[] }[];
  }

  private encryptTokens(token: { access_token: string; refresh_token?: string; expires_in?: number }): TokenSet {
    return {
      accessTokenCifrado: encryptSecret(token.access_token),
      refreshTokenCifrado: token.refresh_token ? encryptSecret(token.refresh_token) : null,
      expiresInSeconds: typeof token.expires_in === "number" ? token.expires_in : null,
    };
  }

  // never logs tokens, codes or the state
  private logError(message: string, provider: string, detail: unknown) {
    const error = detail instanceof Error ? { name: detail.name, message: detail.message } : detail;
    this.logger.handle({ layer: "service", service: this.constructor.name, provider, error }, ErrorLevelsEnum.Values.ERROR, message);
  }
}

export default IntegracaoService;
