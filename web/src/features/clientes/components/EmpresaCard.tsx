import { Link } from "react-router-dom";
import { ExternalLink, Pencil } from "lucide-react";
import { FormCard } from "../../../components/ui/PageState";
import { Empresa } from "../api/clientes.api";
import { papelLabel } from "../utils/clientes.labels";
import { useSetorLabel } from "../hooks/useClientes";
import { AtalhosDeAtividade, ClienteAcoes, ClienteResumo, Senioridade } from "./ClienteAcoes";
import { TipoAtividade } from "../api/atividades.api";
import { AlvoDaAtividade } from "./AtividadeModal";

// one company and its contacts, in rank order: decision makers, then seniority, then name
type Props = {
  empresa: Empresa;
  onEditar: (id: string) => void;
  onPagamento: (c: ClienteResumo) => void;
  onAtividade: (alvo: AlvoDaAtividade, tipo: TipoAtividade) => void;
};

export function EmpresaCard({ empresa, onEditar, onPagamento, onAtividade }: Props) {
  const ocultos = empresa.total_contatos - empresa.contatos.length;
  const setor = useSetorLabel();

  return (
    <FormCard className="max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">
            {/* the name opens the company's page (city, owner, Funil stage...); the icon opens it in HubSpot */}
            <Link to={`/clientes/empresas/${empresa.id}`} className="hover:underline">
              {empresa.nome}
            </Link>
            {empresa.url && (
              <a
                href={empresa.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir ${empresa.nome} no HubSpot`}
                title="Abrir no HubSpot"
                className="ml-1 inline-flex align-middle text-muted hover:text-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </h3>
          <p className="text-sm text-muted">{[empresa.dominio, setor(empresa.setor)].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {empresa.total_contatos} contato(s) · {empresa.total_decisores} decisor(es)
          </p>
          <span className="flex gap-1">
            <AtalhosDeAtividade nome={empresa.nome} comEmail={false} onAtividade={(tipo) => onAtividade({ empresaId: empresa.id, nome: empresa.nome }, tipo)} />
          </span>
          <Link
            to={`/clientes/empresas/${empresa.id}`}
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            aria-label={`Editar empresa ${empresa.nome}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar empresa
          </Link>
        </div>
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
                <th className="py-1 pr-3 font-medium">Papéis</th>
                <th className="py-1 font-medium"><span className="sr-only">Ações</span></th>
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
                  <td className="py-1.5 pr-3 text-ink"><Senioridade valor={contato.senioridade} origem={contato.senioridadeOrigem} /></td>
                  <td className="py-1.5 pr-3">
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
                  <td className="py-1">
                    <ClienteAcoes
                      cliente={contato}
                      onEditar={onEditar}
                      onPagamento={onPagamento}
                      onAtividade={(c, tipo) => onAtividade({ contatoId: c.id, empresaId: empresa.id, nome: c.nome, email: c.email }, tipo)}
                    />
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
