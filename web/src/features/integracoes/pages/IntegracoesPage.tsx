import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, Link2, Loader2, Send, Unlink } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Select } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader, SuccessAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatDateTime } from "../../../lib/form";
import { isAdminRole } from "../../../lib/permissoes";
import { Integracao } from "../api/integracoes.api";
import {
  useConnectIntegracao,
  useDisconnectIntegracao,
  useIntegracoes,
  useJiraProjects,
  useJiraTestIssue,
  useSaveJiraConfig,
} from "../hooks/useIntegracoes";

// ?erro=<reason> set by the API's OAuth callback
const callbackErrors: Record<string, string> = {
  acesso_negado: "A conexão foi cancelada na tela de autorização.",
  estado_invalido: "O pedido de conexão expirou ou já foi usado. Clique em Conectar de novo.",
  troca_de_token: "O provedor recusou a autorização. Tente conectar de novo.",
  sem_site: "Sua conta Atlassian não tem acesso a nenhum site do Jira.",
  nao_configurada: "Esta integração não está configurada no servidor.",
  provedor: "O provedor não respondeu como esperado. Tente de novo em instantes.",
};

function JiraSettings({ integracao }: { integracao: Integracao }) {
  const projectsQuery = useJiraProjects(true);
  const saveMutation = useSaveJiraConfig();
  const testMutation = useJiraTestIssue();
  const [projectKey, setProjectKey] = useState(integracao.config?.projectKey ?? "");
  const [issueTypeId, setIssueTypeId] = useState(integracao.config?.issueTypeId ?? "");

  const project = projectsQuery.data?.find((p) => p.key === projectKey);
  const saved = integracao.config?.projectKey && integracao.config?.issueTypeId;
  const dirty = projectKey !== (integracao.config?.projectKey ?? "") || issueTypeId !== (integracao.config?.issueTypeId ?? "");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    testMutation.reset();
    saveMutation.mutate({ projectKey, issueTypeId });
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="text-sm font-semibold text-ink">Onde criar as issues</h4>
      {projectsQuery.isLoading ? (
        <LoadingState label="Carregando projetos do Jira..." />
      ) : projectsQuery.error ? (
        <ErrorAlert className="mt-2" message={getApiErrorMessage(projectsQuery.error, "Não foi possível carregar os projetos do Jira.")} />
      ) : (
        <form onSubmit={handleSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="jira-projeto" label="Projeto">
            <Select
              id="jira-projeto"
              value={projectKey}
              onChange={(e) => {
                setProjectKey(e.target.value);
                setIssueTypeId("");
              }}
            >
              <option value="" disabled>
                Selecione...
              </option>
              {projectsQuery.data?.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} ({p.key})
                </option>
              ))}
            </Select>
          </Field>
          <Field id="jira-tipo" label="Tipo de issue">
            <Select id="jira-tipo" value={issueTypeId} onChange={(e) => setIssueTypeId(e.target.value)} disabled={!project}>
              <option value="" disabled>
                Selecione...
              </option>
              {project?.issueTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={!projectKey || !issueTypeId || !dirty || saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Salvar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => testMutation.mutate()}
              disabled={!saved || dirty || testMutation.isPending}
            >
              {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Criar issue de teste
            </Button>
          </div>
        </form>
      )}
      {saveMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(saveMutation.error, "Não foi possível salvar.")} />}
      {testMutation.isError && (
        <ErrorAlert className="mt-3" message={getApiErrorMessage(testMutation.error, "Não foi possível criar a issue de teste.")} />
      )}
      {testMutation.data && (
        <p className="mt-3 text-sm text-ink">
          Issue criada:{" "}
          <a href={testMutation.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            {testMutation.data.key}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      )}
    </div>
  );
}

function IntegracaoCard({ integracao }: { integracao: Integracao }) {
  const connectMutation = useConnectIntegracao();
  const disconnectMutation = useDisconnectIntegracao();
  const { conta } = integracao;

  const handleDisconnect = () => {
    if (!window.confirm(`Desconectar ${integracao.nome}? O ERP deixa de acessar sua conta.`)) return;
    disconnectMutation.mutate(integracao.provider);
  };

  return (
    <FormCard className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{integracao.nome}</h3>
          {!integracao.configurado ? (
            <p className="mt-1 text-sm text-muted">
              Não configurada no servidor: defina JIRA_CLIENT_ID, JIRA_CLIENT_SECRET e INTEGRATIONS_ENCRYPTION_KEY em api/.env.
            </p>
          ) : integracao.conectado ? (
            <p className="mt-1 text-sm text-muted">
              Conectado a{" "}
              {conta?.siteUrl ? (
                <a href={conta.siteUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                  {conta.siteName ?? conta.siteUrl}
                </a>
              ) : (
                "sua conta"
              )}
              {integracao.conectadoPor && ` por ${integracao.conectadoPor}`}
              {integracao.conectadoEm && ` em ${formatDateTime(integracao.conectadoEm)}`}.
              {(conta?.sites ?? 1) > 1 && ` Sua conta tem ${conta?.sites} sites; o primeiro foi usado.`}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Desconectado.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {integracao.conectado && (
            <Button variant="secondary" onClick={handleDisconnect} disabled={disconnectMutation.isPending}>
              <Unlink className="h-4 w-4" aria-hidden="true" />
              Desconectar
            </Button>
          )}
          <Button
            variant={integracao.conectado ? "ghost" : "primary"}
            onClick={() => connectMutation.mutate(integracao.provider)}
            disabled={!integracao.configurado || connectMutation.isPending}
          >
            {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {integracao.conectado ? "Reconectar" : "Conectar"}
          </Button>
        </div>
      </div>
      {connectMutation.isError && (
        <ErrorAlert className="mt-3" message={getApiErrorMessage(connectMutation.error, "Não foi possível iniciar a conexão.")} />
      )}
      {disconnectMutation.isError && (
        <ErrorAlert className="mt-3" message={getApiErrorMessage(disconnectMutation.error, "Não foi possível desconectar.")} />
      )}
      {integracao.provider === "jira" && integracao.conectado && <JiraSettings integracao={integracao} />}
    </FormCard>
  );
}

export const IntegracoesPage = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error } = useIntegracoes();

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem gerenciar integrações." />;
  }

  const status = searchParams.get("status");
  const callbackError = searchParams.get("erro");
  const dismiss = () => setSearchParams({}, { replace: true });

  return (
    <div>
      <PageHeader title="Integrações" />
      {status === "conectado" && (
        <div className="mb-4 flex max-w-3xl items-start gap-2">
          <SuccessAlert className="flex-1" message="Conexão concluída." />
          <Button variant="ghost" onClick={dismiss}>
            Fechar
          </Button>
        </div>
      )}
      {callbackError && (
        <div className="mb-4 flex max-w-3xl items-start gap-2">
          <ErrorAlert className="flex-1" message={callbackErrors[callbackError] ?? "Não foi possível concluir a conexão."} />
          <Button variant="ghost" onClick={dismiss}>
            Fechar
          </Button>
        </div>
      )}
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar as integrações.")} />
      ) : (
        <div className="space-y-4">
          {data?.map((integracao) => (
            <IntegracaoCard key={integracao.provider} integracao={integracao} />
          ))}
        </div>
      )}
    </div>
  );
};
