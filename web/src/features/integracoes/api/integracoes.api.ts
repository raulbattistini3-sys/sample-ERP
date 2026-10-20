import { apiClient } from "../../../lib/api-client";

export type Integracao = {
  provider: "jira" | "monday";
  nome: string;
  configurado: boolean; // client id/secret and encryption key set on the server
  conectado: boolean;
  conta?: { cloudId?: string; siteName?: string; siteUrl?: string; sites?: number };
  config?: { projectKey?: string; projectName?: string; issueTypeId?: string; issueTypeName?: string };
  conectadoPor?: string | null;
  conectadoEm?: string;
};

export type JiraProject = { key: string; name: string; issueTypes: { id: string; name: string }[] };

export const listIntegracoes = () =>
  apiClient.get<{ data: Integracao[] }>("/integracoes").then((r) => r.data.data);

// the provider's consent screen; the browser goes there and comes back through the API's callback
export const getAuthorizeUrl = (provider: string) =>
  apiClient.get<{ url: string }>(`/integracoes/${provider}/authorize`).then((r) => r.data.url);

export const disconnectIntegracao = (provider: string) => apiClient.delete(`/integracoes/${provider}`);

export const listJiraProjects = () =>
  apiClient.get<{ data: JiraProject[] }>("/integracoes/jira/projetos").then((r) => r.data.data);

export const saveJiraConfig = (config: { projectKey: string; issueTypeId: string }) =>
  apiClient.put("/integracoes/jira/config", config);

export const createJiraTestIssue = () =>
  apiClient.post<{ key: string; url: string }>("/integracoes/jira/teste").then((r) => r.data);
