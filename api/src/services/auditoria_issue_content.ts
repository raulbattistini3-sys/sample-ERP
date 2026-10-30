import type { QueuedEnvio, ResumoLote } from "../repositories/integracao_envios.repository";

// the issue/ticket for one (auditoria, categoria) row: title, description paragraphs and labels.
// Jira uses all three; HubSpot uses the title as the subject and the paragraphs as the description.

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

const numero = (value: number) => value.toLocaleString("pt-BR");

// a whole lote in one categoria: the counts only, so a big import doesn't flood the project
function resumoParagraphs(resumo: ResumoLote) {
  const linhas: [string, number][] = [
    ["Aumentos de preço", resumo.aumentos],
    ["Reduções de preço", resumo.reducoes],
    ["Alterações de ICMS", resumo.icms],
    ["Outras alterações", resumo.outras],
  ];
  return linhas.filter(([, quantidade]) => quantidade > 0).map(([rotulo, quantidade]) => `${rotulo}: ${numero(quantidade)}`);
}

export function buildAuditoriaIssue(item: QueuedEnvio) {
  const acao = acaoLabels[item.acao] ?? item.acao;
  const isCategoriaChange = item.nomeDoProduto?.startsWith("Categoria:") ?? false;
  const quando = new Date(item.dataDeAudicao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (item.resumo) {
    return {
      summary: `[Auditoria] ${item.categoriaNome} — ${numero(item.resumo.total)} produtos alterados`,
      paragraphs: [
        `Data: ${quando}`,
        `Auditor: ${item.auditor ?? "—"}`,
        `Categoria: ${item.categoriaNome}`,
        `Produtos alterados: ${numero(item.resumo.total)}`,
        ...resumoParagraphs(item.resumo),
        "Um produto pode aparecer em mais de uma linha. O detalhe de cada produto está nas auditorias do ERP.",
      ],
      labels: ["erp-auditoria", categoriaLabel(item.categoriaNome)],
    };
  }
  const summary = isCategoriaChange
    ? `[Auditoria] ${acao} da categoria ${item.categoriaNome}`
    : `[Auditoria] ${acao} — ${item.categoriaNome} — ${item.produtos || item.nomeDoProduto || "produto"}`;
  const paragraphs = [
    `Ação: ${acao}`,
    `Data: ${quando}`,
    `Auditor: ${item.auditor ?? "—"}`,
    `Categoria: ${item.categoriaNome}`,
    ...(isCategoriaChange ? [] : [`Produto(s): ${item.produtos || item.nomeDoProduto || "—"}`]),
    // older auditorias have no field list, only the valor de venda before/after
    ...(item.alteracoes.length > 0
      ? item.alteracoes.map(({ campo, antes, depois }) => `${campo}: ${antes} → ${depois}`)
      : isCategoriaChange
        ? []
        : [`Valor: ${money(item.valorAnterior)} → ${money(item.valorAtual)}`]),
    `Observações: ${item.observacoes || "—"}`,
    `Auditoria no ERP: ${item.auditoriaId}`,
  ];
  return { summary, paragraphs, labels: ["erp-auditoria", categoriaLabel(item.categoriaNome)] };
}
