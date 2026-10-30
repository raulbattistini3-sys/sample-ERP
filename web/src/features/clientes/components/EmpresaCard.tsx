import { ExternalLink } from "lucide-react";
import { FormCard } from "../../../components/ui/PageState";
import { Empresa } from "../api/clientes.api";
import { papelLabel, senioridadeLabel } from "../utils/clientes.labels";

// one company and its contacts, in rank order: decision makers, then seniority, then name
export function EmpresaCard({ empresa }: { empresa: Empresa }) {
  const ocultos = empresa.total_contatos - empresa.contatos.length;

  return (
    <FormCard className="max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">
            {empresa.url ? (
              <a href={empresa.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                {empresa.nome}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              empresa.nome
            )}
          </h3>
          <p className="text-sm text-muted">{[empresa.dominio, empresa.setor].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <p className="text-sm text-muted">
          {empresa.total_contatos} contato(s) · {empresa.total_decisores} decisor(es)
        </p>
      </div>

      {empresa.contatos.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nenhum contato nesta empresa.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Rank</th>
                <th className="py-1 pr-3 font-medium">Nome</th>
                <th className="py-1 pr-3 font-medium">Cargo</th>
                <th className="py-1 pr-3 font-medium">Senioridade</th>
                <th className="py-1 font-medium">Papéis</th>
              </tr>
            </thead>
            <tbody>
              {empresa.contatos.map((contato) => (
                <tr key={contato.id} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-muted">{contato.posicao}</td>
                  <td className="py-1.5 pr-3 text-ink">
                    {contato.url ? (
                      <a href={contato.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {contato.nome}
                      </a>
                    ) : (
                      contato.nome
                    )}
                    {contato.email && <span className="block text-xs text-muted">{contato.email}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-ink">{contato.cargo ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink">{senioridadeLabel(contato.senioridade)}</td>
                  <td className="py-1.5">
                    {contato.papeis.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {contato.papeis.map((papel) => (
                          <span
                            key={papel}
                            className={
                              papel === "DECISION_MAKER"
                                ? "rounded-sm bg-accent px-1.5 py-0.5 text-xs font-medium text-white"
                                : "rounded-sm border border-border px-1.5 py-0.5 text-xs text-ink"
                            }
                          >
                            {papelLabel(papel)}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ocultos > 0 && <p className="mt-2 text-xs text-muted">E mais {ocultos} contato(s), que aparecem na lista.</p>}
        </div>
      )}
    </FormCard>
  );
}
