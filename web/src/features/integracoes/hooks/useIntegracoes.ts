import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createJiraTestIssue,
  disconnectIntegracao,
  getAuditoriaJiraIssues,
  getJiraQueue,
  retryJiraQueue,
  getAuthorizeUrl,
  listIntegracoes,
  listJiraProjects,
  saveJiraConfig,
} from "../api/integracoes.api";

export const useIntegracoes = () => useQuery({ queryKey: ["integracoes"], queryFn: listIntegracoes });

export const useJiraProjects = (enabled: boolean) =>
  useQuery({ queryKey: ["integracoes", "jira", "projetos"], queryFn: listJiraProjects, enabled });

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

export const useSaveJiraConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveJiraConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes"] }),
  });
};

export const useJiraTestIssue = () => useMutation({ mutationFn: createJiraTestIssue });

// refreshes while something is still on its way to Jira
export const useAuditoriaJiraIssues = (auditoriaId: string) =>
  useQuery({
    queryKey: ["integracoes", "jira", "auditoria", auditoriaId],
    queryFn: () => getAuditoriaJiraIssues(auditoriaId),
    enabled: !!auditoriaId,
    refetchInterval: (query) => (query.state.data?.some((i) => i.status === "pendente" || i.status === "erro") ? 10_000 : false),
  });

export const useJiraQueue = (enabled: boolean) =>
  useQuery({ queryKey: ["integracoes", "jira", "fila"], queryFn: getJiraQueue, enabled, refetchInterval: 15_000 });

export const useRetryJiraQueue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryJiraQueue,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integracoes", "jira", "fila"] }),
  });
};
