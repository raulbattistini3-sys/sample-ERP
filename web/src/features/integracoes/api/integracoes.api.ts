import { apiClient } from "../../../lib/api-client";

export type ProviderId = "jira" | "hubspot";

export type Integracao = {
  provider: ProviderId;
  nome: string;
  configurado: boolean; // client id/secret and encryption key set on the server
  conectado: boolean;
  // Jira: cloudId/siteName/siteUrl/sites; HubSpot: hubId/siteName/siteUrl
  conta?: { siteName?: string; siteUrl?: string; sites?: number };
  // Jira: projectKey/projectName/issueTypeId/issueTypeName; HubSpot: pipelineId/pipelineName/stageId/stageName
  config?: Record<string, unknown>;
  conectadoPor?: string | null;
  conectadoEm?: string;
};

export type JiraProject = { key: string; name: string; issueTypes: { id: string; name: string }[] };

export type HubspotPipeline = { id: string; label: string; stages: { id: string; label: string }[] };

// ---- issues/tickets of new auditorias ----

export type AuditoriaEnvio = {
  provider: string; // a ProviderId, or a former integration on older auditorias
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

export const listHubspotPipelines = () =>
  apiClient.get<{ data: HubspotPipeline[] }>("/integracoes/hubspot/pipelines").then((r) => r.data.data);

export const saveHubspotConfig = (config: { pipelineId: string; stageId: string }) =>
  apiClient.put("/integracoes/hubspot/config", config);

export const createHubspotTestTicket = () =>
  apiClient.post<{ key: string; url: string }>("/integracoes/hubspot/teste").then((r) => r.data);

export const getAuditoriaEnvios = (auditoriaId: string) =>
  apiClient.get<{ data: AuditoriaEnvio[] }>(`/integracoes/auditorias/${auditoriaId}`).then((r) => r.data.data);

export const getQueueSummary = (provider: ProviderId) =>
  apiClient.get<{ data: QueueSummary }>(`/integracoes/${provider}/fila`).then((r) => r.data.data);

export const retryQueue = (provider: ProviderId) => apiClient.post(`/integracoes/${provider}/fila/reenviar`);
