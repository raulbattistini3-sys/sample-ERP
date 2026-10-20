import { QueuedIssue } from "../repositories/jira_outbox.repository";

// the Jira issue for one (auditoria, categoria) row: summary, description paragraphs and labels

const acaoLabels: Record<string, string> = { Criacao: "Criação", Alteracao: "Alteração", Delecao: "Deleção" };

// "COMERCIO & SEGURANCA" -> "categoria-comercio-seguranca" (Jira labels can't contain spaces)
export const categoriaLabel = (nome: string) =>
  `categoria-${nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

const money = (value: string | null) => (value === null ? "—" : `R$ ${Number(value).toFixed(2).replace(".", ",")}`);

export function buildAuditoriaIssue(item: QueuedIssue) {
  const acao = acaoLabels[item.acao] ?? item.acao;
  const isCategoriaChange = item.nomeDoProduto?.startsWith("Categoria:") ?? false;
  const quando = new Date(item.dataDeAudicao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const summary = isCategoriaChange
    ? `[Auditoria] ${acao} da categoria ${item.categoriaNome}`
    : `[Auditoria] ${acao} — ${item.categoriaNome} — ${item.produtos || item.nomeDoProduto || "produto"}`;
  const paragraphs = [
    `Ação: ${acao}`,
    `Data: ${quando}`,
    `Auditor: ${item.auditor ?? "—"}`,
    `Categoria: ${item.categoriaNome}`,
    ...(isCategoriaChange
      ? []
      : [`Produto(s): ${item.produtos || item.nomeDoProduto || "—"}`, `Valor: ${money(item.valorAnterior)} → ${money(item.valorAtual)}`]),
    `Observações: ${item.observacoes || "—"}`,
    `Auditoria no ERP: ${item.auditoriaId}`,
  ];
  return { summary, paragraphs, labels: ["erp-auditoria", categoriaLabel(item.categoriaNome)] };
}
