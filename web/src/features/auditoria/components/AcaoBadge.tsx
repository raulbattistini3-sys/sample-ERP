import { cn } from "../../../lib/cn";
import { Auditoria } from "../types/auditoria.types";
import { acaoLabels } from "../utils/format";

const acaoStyles: Record<Auditoria["acao_efetuada"], string> = {
  Criacao: "bg-accent-soft text-accent",
  Alteracao: "bg-warning-soft text-warning",
  Delecao: "bg-danger-soft text-danger",
};

export function AcaoBadge({ acao }: { acao: Auditoria["acao_efetuada"] }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", acaoStyles[acao])}>
      {acaoLabels[acao] ?? acao}
    </span>
  );
}
