import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ProviderId,
  createJiraTestIssue,
  createMondayTestItem,
  disconnectIntegracao,
  getAuditoriaEnvios,
  getAuthorizeUrl,
  getQueueSummary,
  listIntegracoes,
  listJiraProjects,
  listMondayBoards,
  retryQueue,
  saveJiraConfig,
  saveMondayConfig,
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

export const useMondayBoards = (enabled: boolean) =>
  useQuery({ queryKey: ["integracoes", "monday", "boards"], queryFn: listMondayBoards, enabled, staleTime: 60_000 });

export const useSaveMondayConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMondayConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes"] }),
  });
};

export const useMondayTestItem = () => useMutation({ mutationFn: createMondayTestItem });

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
