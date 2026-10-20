import { ExternalLink } from "lucide-react";
import { FormCard } from "../../../components/ui/PageState";
import { useAuditoriaJiraIssues } from "../hooks/useIntegracoes";

const statusText = {
  pendente: "Na fila para o Jira",
  erro: "Falhou; nova tentativa em breve",
  cancelada: "Cancelada (auditoria removida)",
} as const;

// the Jira issues created for one auditoria, one per categoria it touches; hidden when there are none
export function AuditoriaJiraIssues({ auditoriaId }: { auditoriaId: string }) {
  const { data } = useAuditoriaJiraIssues(auditoriaId);
  if (!data || data.length === 0) return null;

  return (
    <FormCard>
      <h3 className="mb-3 text-sm font-semibold text-ink">Jira</h3>
      <ul className="space-y-2 text-sm">
        {data.map((issue) => (
          <li key={issue.categoriaNome} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted">{issue.categoriaNome}</span>
            {issue.status === "enviada" && issue.issueUrl ? (
              <a href={issue.issueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {issue.issueKey}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className={issue.status === "erro" ? "text-red-700" : "text-muted"} title={issue.ultimoErro ?? undefined}>
                {statusText[issue.status as keyof typeof statusText] ?? issue.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </FormCard>
  );
}
