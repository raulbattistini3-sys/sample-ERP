import { ExternalLink } from "lucide-react";
import { FormCard } from "../../../components/ui/PageState";
import { ProviderId } from "../api/integracoes.api";
import { useAuditoriaEnvios } from "../hooks/useIntegracoes";

const providerLabels: Record<ProviderId, string> = { jira: "Jira", monday: "monday.com" };

const statusText = {
  pendente: "Na fila",
  enviando: "Sendo criada",
  erro: "Falhou; nova tentativa em breve",
  cancelada: "Cancelada (auditoria removida)",
} as const;

// what the integrations created for one auditoria (a Jira issue / monday item per categoria); hidden
// when there's nothing
export function AuditoriaIntegracoes({ auditoriaId }: { auditoriaId: string }) {
  const { data } = useAuditoriaEnvios(auditoriaId);
  if (!data || data.length === 0) return null;

  return (
    <FormCard>
      <h3 className="mb-3 text-sm font-semibold text-ink">Integrações</h3>
      <ul className="space-y-2 text-sm">
        {data.map((envio) => (
          <li key={`${envio.provider}-${envio.categoriaNome}`} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted">
              {providerLabels[envio.provider]} · {envio.categoriaNome}
            </span>
            {envio.status === "enviada" && envio.externalUrl ? (
              <a href={envio.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {envio.provider === "jira" ? envio.externalId : "Abrir item"}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className={envio.status === "erro" ? "text-red-700" : "text-muted"} title={envio.ultimoErro ?? undefined}>
                {statusText[envio.status as keyof typeof statusText] ?? envio.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </FormCard>
  );
}
