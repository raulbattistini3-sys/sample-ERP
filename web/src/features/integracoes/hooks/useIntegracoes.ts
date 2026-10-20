import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createJiraTestIssue,
  disconnectIntegracao,
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
