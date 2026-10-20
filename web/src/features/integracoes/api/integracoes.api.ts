import { apiClient } from "../../../lib/api-client";

export type ProviderId = "jira" | "monday";

export type Integracao = {
  provider: ProviderId;
  nome: string;
  configurado: boolean; // client id/secret and encryption key set on the server
  conectado: boolean;
  // Jira: cloudId/siteName/siteUrl/sites; monday: accountId/accountName/accountSlug/siteUrl
  conta?: { siteName?: string; siteUrl?: string; sites?: number; accountName?: string };
  // Jira: projectKey/projectName/issueTypeId/issueTypeName; monday: MondayConfig
  config?: Record<string, unknown>;
  conectadoPor?: string | null;
  conectadoEm?: string;
};

export type JiraProject = { key: string; name: string; issueTypes: { id: string; name: string }[] };

// ---- monday.com ----

export type MondayColumn = { id: string; title: string; type: string };
export type MondayBoard = {
  id: string;
  name: string;
  workspace: string | null;
  groups: { id: string; title: string }[];
  columns: MondayColumn[];
};
// an auditoria field that can fill a board column, and the column types that accept it
export type MondayCampo = { key: string; label: string; types: string[] };
export type MondayConfig = {
  boardId: string;
  boardName: string;
  groupId: string | null;
  groupTitle: string | null;
  columns: Record<string, MondayColumn>;
};

// ---- issues/items of new auditorias ----

export type AuditoriaEnvio = {
  provider: ProviderId;
  categoriaNome: string;
  status: "pendente" | "enviando" | "enviada" | "erro" | "cancelada";
  externalId: string | null;
  externalUrl: string | null;
  tentativas: number;
  ultimoErro: string | null;
};

export type QueueSummary = {
  enviadas: number;
  pendentes: number;
  comErro: number;
  esgotadas: number;
  maxTentativas: number;
  erros: { categoriaNome: string; auditoriaId: string; ultimoErro: string | null; tentativas: number }[];
};

export const listIntegracoes = () =>
  apiClient.get<{ data: Integracao[] }>("/integracoes").then((r) => r.data.data);

// the provider's consent screen; the browser goes there and comes back through the API's callback
export const getAuthorizeUrl = (provider: ProviderId) =>
  apiClient.get<{ url: string }>(`/integracoes/${provider}/authorize`).then((r) => r.data.url);

export const disconnectIntegracao = (provider: ProviderId) => apiClient.delete(`/integracoes/${provider}`);

export const listJiraProjects = () =>
  apiClient.get<{ data: JiraProject[] }>("/integracoes/jira/projetos").then((r) => r.data.data);

export const saveJiraConfig = (config: { projectKey: string; issueTypeId: string }) =>
  apiClient.put("/integracoes/jira/config", config);

export const createJiraTestIssue = () =>
  apiClient.post<{ key: string; url: string }>("/integracoes/jira/teste").then((r) => r.data);

export const listMondayBoards = () =>
  apiClient
    .get<{ data: { boards: MondayBoard[]; campos: MondayCampo[] } }>("/integracoes/monday/boards")
    .then((r) => r.data.data);

// columns: auditoria field -> column id ("" or missing = not filled)
export const saveMondayConfig = (config: { boardId: string; groupId: string | null; columns: Record<string, string> }) =>
  apiClient.put("/integracoes/monday/config", config);

export const createMondayTestItem = () =>
  apiClient.post<{ key: string; url: string }>("/integracoes/monday/teste").then((r) => r.data);

export const getAuditoriaEnvios = (auditoriaId: string) =>
  apiClient.get<{ data: AuditoriaEnvio[] }>(`/integracoes/auditorias/${auditoriaId}`).then((r) => r.data.data);

export const getQueueSummary = (provider: ProviderId) =>
  apiClient.get<{ data: QueueSummary }>(`/integracoes/${provider}/fila`).then((r) => r.data.data);

export const retryQueue = (provider: ProviderId) => apiClient.post(`/integracoes/${provider}/fila/reenviar`);
