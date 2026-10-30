import { z } from "zod";
import IntegracaoRepository, { IntegracaoRow } from "../repositories/integracao.repository";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { decryptSecret } from "../utils/helpers/crypto.util";
import { MondayApiError, mondayRequest } from "../integrations/monday/monday.client";
import { BoardQuery, BoardsQuery, CreateItemMutation, CreateUpdateMutation } from "../integrations/monday/monday.operations";
import type { ColumnType } from "../integrations/monday/gql/graphql";
import type { QueuedEnvio } from "../repositories/integracao_envios.repository";
import { buildAuditoriaIssue } from "./auditoria_issue_content";

// The auditoria fields an admin can map to columns of the chosen board, and which monday column types
// can hold each. Sent to the web app with the boards, so both sides use the same list.
export const MONDAY_FIELDS = [
  { key: "categoria", label: "Categoria", types: ["status", "dropdown", "text"] },
  { key: "acao", label: "Ação", types: ["status", "dropdown", "text"] },
  { key: "data", label: "Data da auditoria", types: ["date"] },
  { key: "auditor", label: "Auditor", types: ["text"] },
  { key: "valorAnterior", label: "Valor anterior", types: ["numbers"] },
  { key: "valorAtual", label: "Valor atual", types: ["numbers"] },
  { key: "observacoes", label: "Observações", types: ["long_text", "text"] },
] as const satisfies readonly { key: string; label: string; types: readonly ColumnType[] }[];

type FieldKey = (typeof MONDAY_FIELDS)[number]["key"];
type MappedColumn = { id: string; title: string; type: ColumnType };

export type MondayConfig = {
  boardId: string;
  boardName: string;
  groupId: string | null;
  groupTitle: string | null;
  columns: Partial<Record<FieldKey, MappedColumn>>;
};

const ConfigSchema = z.object({
  boardId: z.string({ required_error: "Escolha um quadro." }).trim().min(1, "Escolha um quadro."),
  groupId: z.string().trim().nullish(),
  columns: z.record(z.string(), z.string().trim()).default({}),
});

const notConnected = () => new ValidationError("409", "O monday.com não está conectado. Conecte em Integrações.");
const notConfigured = () => new ValidationError("409", "Escolha o quadro do monday.com em Integrações.");

const acaoLabels: Record<string, string> = { Criacao: "Criação", Alteracao: "Alteração", Delecao: "Deleção" };

// monday expects a different JSON shape per column type
// (https://developer.monday.com/api-reference/reference/column-types-reference)
function columnValue(type: ColumnType, value: string | number | Date): unknown {
  switch (type) {
    case "status":
      return { label: String(value) };
    case "dropdown":
      return { labels: [String(value)] };
    case "long_text":
      return { text: String(value) };
    case "numbers":
      return String(value);
    case "date": {
      const iso = (value as Date).toISOString(); // UTC, as monday stores it
      return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
    }
    default:
      return String(value);
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

class MondayService {
  constructor(
    private readonly repository: IntegracaoRepository,
    private readonly logger: LoggerInterface,
    private readonly options: { apiUrl: string; fetch: typeof fetch },
  ) {}

  async listBoards(): Promise<Either<BaseAppError, { boards: unknown[]; campos: typeof MONDAY_FIELDS }>> {
    const boards: unknown[] = [];
    for (let page = 1; page <= 5; page++) {
      const result = await this.call(BoardsQuery, { limit: 100, page });
      if (result.isLeft()) return left(result.value);
      const batch = (result.value.boards ?? []).filter((b) => b !== null).map((b) => ({
        id: b.id,
        name: b.name,
        workspace: b.workspace?.name ?? null,
        groups: (b.groups ?? []).filter((g) => g !== null),
        columns: (b.columns ?? []).filter((c) => c !== null),
      }));
      boards.push(...batch);
      if (batch.length < 100) break;
    }
    return right({ boards, campos: MONDAY_FIELDS });
  }

  // checks the board, group and every mapped column (exists, compatible type) against monday
  async saveConfig(payload: unknown): Promise<Either<BaseAppError, MondayConfig>> {
    const parsed = ConfigSchema.safeParse(payload);
    if (!parsed.success) return left(new ValidationError("400", parsed.error.errors.map((e) => e.message).join(", ")));
    const result = await this.call(BoardQuery, { id: parsed.data.boardId });
    if (result.isLeft()) return left(result.value);
    const board = result.value.boards?.[0];
    if (!board) return left(new ValidationError("400", "Quadro não encontrado no monday.com"));

    const group = parsed.data.groupId ? board.groups?.find((g) => g?.id === parsed.data.groupId) : null;
    if (parsed.data.groupId && !group) return left(new ValidationError("400", "Esse grupo não existe nesse quadro"));

    const columns: MondayConfig["columns"] = {};
    for (const field of MONDAY_FIELDS) {
      const columnId = parsed.data.columns[field.key];
      if (!columnId) continue;
      const column = board.columns?.find((c) => c?.id === columnId);
      if (!column) return left(new ValidationError("400", `A coluna escolhida para "${field.label}" não existe no quadro`));
      if (!(field.types as readonly string[]).includes(column.type)) {
        return left(new ValidationError("400", `A coluna "${column.title}" (${column.type}) não aceita "${field.label}"`));
      }
      columns[field.key] = { id: column.id, title: column.title, type: column.type };
    }
    const config: MondayConfig = {
      boardId: board.id,
      boardName: board.name,
      groupId: group?.id ?? null,
      groupTitle: group?.title ?? null,
      columns,
    };
    await this.repository.updateConfig("monday", config);
    return right(config);
  }

  async createTestItem(usuarioNome: string): Promise<Either<BaseAppError, { key: string; url: string }>> {
    return this.createItem("Teste de integração — ERP Estoque", {}, [
      `Item de teste criado por ${usuarioNome} em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
      "A conexão entre o ERP Estoque e o monday.com está funcionando. Este item pode ser apagado.",
    ]);
  }

  // the item for one (auditoria, categoria) row; the mapped columns are filled, the rest goes in an update
  async createAuditoriaItem(envio: QueuedEnvio): Promise<Either<BaseAppError, { key: string; url: string }>> {
    const { summary, paragraphs } = buildAuditoriaIssue(envio);
    const values: Partial<Record<FieldKey, string | number | Date>> = {
      categoria: envio.categoriaNome,
      acao: acaoLabels[envio.acao] ?? envio.acao,
      data: new Date(envio.dataDeAudicao),
      ...(envio.auditor && { auditor: envio.auditor }),
      ...(envio.valorAnterior !== null && { valorAnterior: Number(envio.valorAnterior) }),
      ...(envio.valorAtual !== null && { valorAtual: Number(envio.valorAtual) }),
      ...(envio.observacoes && { observacoes: envio.observacoes }),
    };
    return this.createItem(summary, values, paragraphs);
  }

  private async createItem(
    name: string,
    values: Partial<Record<FieldKey, string | number | Date>>,
    paragraphs: string[],
  ): Promise<Either<BaseAppError, { key: string; url: string }>> {
    const row = await this.repository.find("monday");
    if (!row) return left(notConnected());
    const config = row.config as Partial<MondayConfig>;
    if (!config.boardId) return left(notConfigured());

    const columnValues: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(config.columns ?? {}) as [FieldKey, MappedColumn][]) {
      const value = values[field];
      if (value !== undefined && value !== "") columnValues[column.id] = columnValue(column.type, value);
    }
    const created = await this.call(
      CreateItemMutation,
      { boardId: config.boardId, groupId: config.groupId ?? null, name: name.slice(0, 255), columnValues: JSON.stringify(columnValues) },
      row,
    );
    if (created.isLeft()) return left(created.value);
    const item = created.value.create_item;
    if (!item) return left(new ServerError("503", true, "O monday.com não devolveu o item criado."));

    // the item exists now: a failed update is logged, never retried (a retry would create a second item)
    const update = await this.call(
      CreateUpdateMutation,
      { itemId: item.id, body: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") },
      row,
    );
    if (update.isLeft()) {
      this.logger.handle({ layer: "service", service: this.constructor.name, itemId: item.id, error: update.value.message }, ErrorLevelsEnum.Values.WARN, "monday item created without its update");
    }
    return right({ key: item.id, url: item.url });
  }

  // one typed GraphQL call with the stored token; monday's failures become the API's errors
  private async call<TResult, TVariables>(
    document: Parameters<typeof mondayRequest<TResult, TVariables>>[1],
    variables: TVariables,
    connection?: IntegracaoRow,
  ): Promise<Either<BaseAppError, TResult>> {
    const row = connection ?? (await this.repository.find("monday"));
    if (!row) return left(notConnected());
    try {
      const token = decryptSecret(row.accessTokenCifrado);
      return right(await mondayRequest({ apiUrl: this.options.apiUrl, token, fetch: this.options.fetch }, document, variables));
    } catch (error) {
      if (error instanceof MondayApiError) {
        if (error.kind === "auth") {
          return left(new ValidationError("409", "A conexão com o monday.com foi revogada. Conecte novamente em Integrações."));
        }
        if (error.kind === "request") return left(new ValidationError("400", `monday.com: ${error.message}`));
        return left(new ServerError("503", true, "O monday.com está indisponível ou limitou as requisições. Tente novamente.", error));
      }
      this.logger.handle({ layer: "service", service: this.constructor.name, error: (error as Error).message }, ErrorLevelsEnum.Values.ERROR, "monday request failed");
      return left(new ServerError("503", true, "O monday.com não respondeu como esperado. Tente novamente.", error));
    }
  }
}

export default MondayService;
