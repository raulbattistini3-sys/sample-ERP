import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, Link2, Loader2, RotateCcw, Send, Unlink } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Select } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader, SuccessAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatDateTime } from "../../../lib/form";
import { isAdminRole } from "../../../lib/permissoes";
import { Integracao, ProviderId } from "../api/integracoes.api";
import {
  useConnectIntegracao,
  useDisconnectIntegracao,
  useHubspotPipelines,
  useHubspotTestTicket,
  useIntegracoes,
  useJiraProjects,
  useJiraTestIssue,
  useQueueSummary,
  useRetryQueue,
  useSaveHubspotConfig,
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

const envKeys: Record<ProviderId, string> = {
  jira: "JIRA_CLIENT_ID, JIRA_CLIENT_SECRET",
  hubspot: "HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET",
};

const queueTexts: Record<ProviderId, { title: string; description: string }> = {
  jira: { title: "Auditorias no Jira", description: "Cada nova auditoria cria uma issue no projeto acima para cada categoria envolvida." },
  hubspot: { title: "Auditorias no HubSpot", description: "Cada nova auditoria cria um ticket no pipeline acima para cada categoria envolvida." },
};

function CreatedLink({ label, data }: { label: string; data?: { key: string; url: string } }) {
  if (!data) return null;
  return (
    <p className="mt-3 text-sm text-ink">
      {label}:{" "}
      <a href={data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
        {data.key}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </p>
  );
}

function JiraSettings({ integracao }: { integracao: Integracao }) {
  const projectsQuery = useJiraProjects(true);
  const saveMutation = useSaveJiraConfig();
  const testMutation = useJiraTestIssue();
  const savedProject = (integracao.config?.projectKey as string | undefined) ?? "";
  const savedType = (integracao.config?.issueTypeId as string | undefined) ?? "";
  const [projectKey, setProjectKey] = useState(savedProject);
  const [issueTypeId, setIssueTypeId] = useState(savedType);

  const project = projectsQuery.data?.find((p) => p.key === projectKey);
  const saved = !!savedProject && !!savedType;
  const dirty = projectKey !== savedProject || issueTypeId !== savedType;

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
            <Button type="button" variant="secondary" onClick={() => testMutation.mutate()} disabled={!saved || dirty || testMutation.isPending}>
              {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Criar issue de teste
            </Button>
          </div>
        </form>
      )}
      {saveMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(saveMutation.error, "Não foi possível salvar.")} />}
      {testMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(testMutation.error, "Não foi possível criar a issue de teste.")} />}
      <CreatedLink label="Issue criada" data={testMutation.data} />
    </div>
  );
}

// the pipeline, and the status new tickets start in
function HubspotSettings({ integracao }: { integracao: Integracao }) {
  const pipelinesQuery = useHubspotPipelines(true);
  const saveMutation = useSaveHubspotConfig();
  const testMutation = useHubspotTestTicket();
  const savedPipeline = (integracao.config?.pipelineId as string | undefined) ?? "";
  const savedStage = (integracao.config?.stageId as string | undefined) ?? "";
  const [pipelineId, setPipelineId] = useState(savedPipeline);
  const [stageId, setStageId] = useState(savedStage);

  const pipeline = pipelinesQuery.data?.find((p) => p.id === pipelineId);
  const saved = !!savedPipeline && !!savedStage;
  const dirty = pipelineId !== savedPipeline || stageId !== savedStage;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    testMutation.reset();
    saveMutation.mutate({ pipelineId, stageId });
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="text-sm font-semibold text-ink">Onde criar os tickets</h4>
      {pipelinesQuery.isLoading ? (
        <LoadingState label="Carregando pipelines do HubSpot..." />
      ) : pipelinesQuery.error ? (
        <ErrorAlert className="mt-2" message={getApiErrorMessage(pipelinesQuery.error, "Não foi possível carregar os pipelines do HubSpot.")} />
      ) : (
        <form onSubmit={handleSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="hubspot-pipeline" label="Pipeline">
            <Select
              id="hubspot-pipeline"
              value={pipelineId}
              onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId("");
              }}
            >
              <option value="" disabled>
                Selecione...
              </option>
              {pipelinesQuery.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="hubspot-status" label="Status inicial">
            <Select id="hubspot-status" value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={!pipeline}>
              <option value="" disabled>
                Selecione...
              </option>
              {pipeline?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={!pipelineId || !stageId || !dirty || saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Salvar
            </Button>
            <Button type="button" variant="secondary" onClick={() => testMutation.mutate()} disabled={!saved || dirty || testMutation.isPending}>
              {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Criar ticket de teste
            </Button>
          </div>
        </form>
      )}
      {saveMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(saveMutation.error, "Não foi possível salvar.")} />}
      {testMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(testMutation.error, "Não foi possível criar o ticket de teste.")} />}
      <CreatedLink label="Ticket criado" data={testMutation.data} />
    </div>
  );
}

// automatic issues/tickets: one per categoria of every new auditoria (created by the API's queue worker)
function QueueStatus({ provider }: { provider: ProviderId }) {
  const { data } = useQueueSummary(provider);
  const retryMutation = useRetryQueue(provider);
  if (!data) return null;
  const failing = data.comErro + data.esgotadas;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h4 className="text-sm font-semibold text-ink">{queueTexts[provider].title}</h4>
      <p className="mt-1 text-sm text-muted">{queueTexts[provider].description}</p>
      <p className="mt-2 text-sm text-ink">
        {data.enviadas} enviada(s) · {data.pendentes} na fila · {failing} com erro
        {data.esgotadas > 0 && ` (${data.esgotadas} desistiram após ${data.maxTentativas} tentativas)`}
      </p>
      {data.erros.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-red-700">
          {data.erros.map((erro) => (
            <li key={`${erro.auditoriaId}-${erro.categoriaNome}`}>
              {erro.categoriaNome} (tentativa {erro.tentativas}): {erro.ultimoErro ?? "erro desconhecido"}
            </li>
          ))}
        </ul>
      )}
      {data.esgotadas > 0 && (
        <Button variant="secondary" className="mt-3" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reenviar as que desistiram
        </Button>
      )}
    </div>
  );
}

function IntegracaoCard({ integracao }: { integracao: Integracao }) {
  const connectMutation = useConnectIntegracao();
  const disconnectMutation = useDisconnectIntegracao();
  const { conta, config } = integracao;
  const ready = integracao.provider === "jira" ? !!config?.projectKey : !!config?.stageId;

  const handleDisconnect = () => {
    if (!window.confirm(`Desconectar ${integracao.nome}? O ERP deixa de acessar sua conta.`)) return;
    disconnectMutation.mutate(integracao.provider);
  };

  return (
    <FormCard className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{integracao.nome}</h3>
          {integracao.chaveDeServico ? (
            <p className="mt-1 text-sm text-muted">
              Usando a chave de serviço definida em api/.env: clientes e empresas vêm direto do HubSpot. O envio de tickets ainda exige a conexão OAuth.
            </p>
          ) : !integracao.configurado ? (
            <p className="mt-1 text-sm text-muted">
              Não configurada no servidor: defina {envKeys[integracao.provider]} e INTEGRATIONS_ENCRYPTION_KEY em api/.env.
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
          {!integracao.chaveDeServico && (
            <Button
              variant={integracao.conectado ? "ghost" : "primary"}
              onClick={() => connectMutation.mutate(integracao.provider)}
              disabled={!integracao.configurado || connectMutation.isPending}
            >
              {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              {integracao.conectado ? "Reconectar" : "Conectar"}
            </Button>
          )}
        </div>
      </div>
      {connectMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(connectMutation.error, "Não foi possível iniciar a conexão.")} />}
      {disconnectMutation.isError && <ErrorAlert className="mt-3" message={getApiErrorMessage(disconnectMutation.error, "Não foi possível desconectar.")} />}
      {integracao.conectado && integracao.provider === "jira" && <JiraSettings integracao={integracao} />}
      {integracao.conectado && integracao.provider === "hubspot" && <HubspotSettings integracao={integracao} />}
      {integracao.conectado && ready && <QueueStatus provider={integracao.provider} />}
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
