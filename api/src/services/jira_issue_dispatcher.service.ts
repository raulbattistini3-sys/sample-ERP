import JiraOutboxRepository, { QueuedIssue } from "../repositories/jira_outbox.repository";
import IntegracaoService from "./integracao.service";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";

export const MAX_ATTEMPTS = 8; // then it waits for "Reenviar" on the Integrações page
const BATCH_SIZE = 10;
const MAX_BATCHES_PER_RUN = 5;
const LEASE_MINUTES = 5; // a claimed row is someone else's to retry only after this
const POLL_MS = 10_000;

const acaoLabels: Record<string, string> = { Criacao: "Criação", Alteracao: "Alteração", Delecao: "Deleção" };

// retry after 1, 2, 4, 8... minutes, at most 1 hour
export const retryDelaySeconds = (tentativas: number) => Math.min(60 * 2 ** Math.max(0, tentativas - 1), 3600);

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

// Sends the queued issues (jira_outbox.repository). Runs every 10s in the API process; safe with
// several API instances, since rows are leased with SKIP LOCKED.
class JiraIssueDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly outbox: JiraOutboxRepository,
    private readonly integracaoService: IntegracaoService,
    private readonly logger: LoggerInterface,
    private readonly pollMs = POLL_MS,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.pollMs);
    this.timer.unref?.(); // never keeps the process alive on its own
    void this.runOnce();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<{ sent: number; failed: number; cancelled: number }> {
    const totals = { sent: 0, failed: 0, cancelled: 0 };
    if (this.running) return totals; // the previous tick is still sending
    this.running = true;
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
        const items = await this.outbox.claimDue(BATCH_SIZE, MAX_ATTEMPTS, LEASE_MINUTES);
        for (const item of items) {
          if (item.auditoriaRemovida) {
            await this.outbox.markCancelled(item.id);
            totals.cancelled++;
            continue;
          }
          const result = await this.integracaoService.createJiraIssue(buildAuditoriaIssue(item));
          if (result.isRight()) {
            await this.outbox.markSent(item.id, result.value.key, result.value.url);
            totals.sent++;
          } else {
            await this.outbox.markFailed(item.id, result.value.message, retryDelaySeconds(item.tentativas));
            totals.failed++;
            this.logger.handle(
              { layer: "dispatcher", dispatcher: this.constructor.name, auditoriaId: item.auditoriaId, categoria: item.categoriaNome, tentativas: item.tentativas },
              ErrorLevelsEnum.Values.WARN,
              `jira issue not created: ${result.value.message}`,
            );
          }
        }
        if (items.length < BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.handle(
        { layer: "dispatcher", dispatcher: this.constructor.name, error: error instanceof Error ? error.message : String(error) },
        ErrorLevelsEnum.Values.ERROR,
        "jira dispatcher run failed",
      );
    } finally {
      this.running = false;
    }
    return totals;
  }
}

export default JiraIssueDispatcher;
