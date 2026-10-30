import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ProviderId,
  createHubspotTestTicket,
  createJiraTestIssue,
  disconnectIntegracao,
  getAuditoriaEnvios,
  getAuthorizeUrl,
  getQueueSummary,
  listHubspotPipelines,
  listIntegracoes,
  listJiraProjects,
  retryQueue,
  saveHubspotConfig,
  saveJiraConfig,
} from "../api/integracoes.api";

export const useIntegracoes = () => useQuery({ queryKey: ["integracoes"], queryFn: listIntegracoes });

// leaves the app for the provider's consent screen
export const useConnectIntegracao = () =>
  useMutation({
    mutationFn: getAuthorizeUrl,
    onSuccess: (url) => window.location.assign(url),
  });

export const useDisconnectIntegracao = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectIntegracao,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes"] }),
  });
};

export const useJiraProjects = (enabled: boolean) =>
  useQuery({ queryKey: ["integracoes", "jira", "projetos"], queryFn: listJiraProjects, enabled });

export const useSaveJiraConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveJiraConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes"] }),
  });
};

export const useJiraTestIssue = () => useMutation({ mutationFn: createJiraTestIssue });

export const useHubspotPipelines = (enabled: boolean) =>
  useQuery({ queryKey: ["integracoes", "hubspot", "pipelines"], queryFn: listHubspotPipelines, enabled, staleTime: 60_000 });

export const useSaveHubspotConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveHubspotConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes"] }),
  });
};

export const useHubspotTestTicket = () => useMutation({ mutationFn: createHubspotTestTicket });

// refreshes while something is still on its way to a provider
export const useAuditoriaEnvios = (auditoriaId: string) =>
  useQuery({
    queryKey: ["integracoes", "auditoria", auditoriaId],
    queryFn: () => getAuditoriaEnvios(auditoriaId),
    enabled: !!auditoriaId,
    refetchInterval: (query) =>
      query.state.data?.some((e) => e.status === "pendente" || e.status === "enviando" || e.status === "erro") ? 10_000 : false,
  });

export const useQueueSummary = (provider: ProviderId) =>
  useQuery({ queryKey: ["integracoes", provider, "fila"], queryFn: () => getQueueSummary(provider), refetchInterval: 15_000 });

export const useRetryQueue = (provider: ProviderId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => retryQueue(provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes", provider, "fila"] }),
  });
};
