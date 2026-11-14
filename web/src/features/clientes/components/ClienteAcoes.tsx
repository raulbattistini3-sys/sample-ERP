import { Pencil } from "lucide-react";
import { Cliente } from "../api/clientes.api";
import { TipoAtividade } from "../api/atividades.api";
import { senioridadeLabel } from "../utils/clientes.labels";
import { PagamentoMensalIcon } from "../../cobrancas/components/PagamentoMensalIcon";
import { ATIVIDADES } from "../utils/atividades";

export type ClienteResumo = Pick<Cliente, "id" | "nome" | "email">;
export type AoAtividade = (tipo: TipoAtividade) => void;

const BOTAO = "rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink";

// note / e-mail / meeting shortcuts (AtividadeModal); without an e-mail address there is no e-mail button
export function AtalhosDeAtividade({ nome, comEmail, onAtividade }: { nome: string; comEmail: boolean; onAtividade: AoAtividade }) {
  return (
    <>
      {ATIVIDADES.filter((a) => a.tipo !== "email" || comEmail).map(({ tipo, label, Icone }) => (
        <button key={tipo} type="button" onClick={() => onAtividade(tipo)} aria-label={`${label}: ${nome}`} title={label} className={BOTAO}>
          <Icone className="h-4 w-4" aria-hidden="true" />
        </button>
      ))}
    </>
  );
}

type Props = {
  cliente: ClienteResumo;
  onEditar: (id: string) => void;
  onPagamento: (c: ClienteResumo) => void;
  onAtividade?: (c: ClienteResumo, tipo: TipoAtividade) => void;
};

// the row actions of a client, in the list and in a company's card
export function ClienteAcoes({ cliente, onEditar, onPagamento, onAtividade }: Props) {
  return (
    <span className="flex gap-1">
      <button type="button" onClick={() => onEditar(cliente.id)} aria-label={`Editar ${cliente.nome}`} title="Editar" className={BOTAO}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      {onAtividade && <AtalhosDeAtividade nome={cliente.nome} comEmail={!!cliente.email} onAtividade={(tipo) => onAtividade(cliente, tipo)} />}
      <button
        type="button"
        onClick={() => onPagamento(cliente)}
        aria-label={`Pagamento mensal de ${cliente.nome}`}
        title={cliente.email ? "Pagamento mensal" : "Pagamento mensal (o cliente precisa de e-mail)"}
        className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-accent"
      >
        <PagamentoMensalIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </span>
  );
}

// the label, marked when it is the ERP's own (HubSpot doesn't have it, or the ERP's overrides it)
export function Senioridade({ valor, origem }: { valor: string | null; origem: Cliente["senioridadeOrigem"] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {senioridadeLabel(valor)}
      {origem === "erp" && (
        <span title="Definida no ERP" className="rounded-sm border border-border px-1 text-[10px] font-medium uppercase text-muted">
          ERP
        </span>
      )}
    </span>
  );
}
