import { QueuedIssue } from "../repositories/jira_outbox.repository";
import { RETRY_TIERS, RetryTier } from "../configs/kafka.config";

export const MAX_ATTEMPTS = 8; // then the dead-letter topic, and "Reenviar" on the Integrações page

// after the 1st failure wait 1 min, after the 2nd 5 min, then 30 min each time
export const retryTierFor = (tentativas: number): RetryTier => RETRY_TIERS[Math.min(Math.max(tentativas, 1), RETRY_TIERS.length) - 1];

const acaoLabels: Record<string, string> = { Criacao: "Criação", Alteracao: "Alteração", Delecao: "Deleção" };

// "COMERCIO & SEGURANCA" -> "categoria-comercio-seguranca" (Jira labels can't contain spaces)
export const categoriaLabel = (nome: string) =>
  `categoria-${nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
