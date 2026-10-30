import ImportacaoRepository, { ImportacaoJob } from "../repositories/importacao.repository";
import IProductService from "../interfaces/product_interfaces/product_service.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum, { type ErrorLevelsEnum as ErrorLevel } from "../enums/errors_enums/errors_levels.enum";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { lerPlanilha, semTotais, skusRepetidos } from "../integrations/importador/planilha";
import { validarEmThreads } from "../integrations/importador/planilha_threads";
import { MAX_IMPORT_ROWS } from "../utils/schemas/produto.schema";

// how long an import may go without a heartbeat before it counts as stuck and goes back to the queue. It
// isn't a limit on the import: updating 5000 products is several statements per row, so on a remote
// database it can take far longer than this, and the heartbeat keeps a live worker's claim.
const PRAZO_SECONDS = 5 * 60;
const HEARTBEAT_MS = 60_000;
const MAX_TENTATIVAS = 3;
// an upload on this API instance wakes the worker at once; this covers uploads on other instances and the
// stuck-import sweep. Not LISTEN: Supabase's transaction pooler doesn't deliver notifications.
const INTERVALO_MS = 30_000;
const STOP_TIMEOUT_MS = 20_000;

// the wrapped errors only say "internal server error"; what went wrong is at the end of the cause chain
const causaRaiz = (error: unknown): string => {
  let atual = error as Error & { cause?: unknown };
  while (atual.cause instanceof Error) atual = atual.cause;
  return atual.message;
};

// Runs the imports queued in the importacoes table when no Go importer is configured, one at a time per
// import process (importacoes.processo.ts). A failure that isn't the spreadsheet's fault (database trouble) leaves the import
// processando, and the sweep retries it after PRAZO_SECONDS, up to MAX_TENTATIVAS.
class ImportacaoWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly importacoes: ImportacaoRepository,
    private readonly products: IProductService,
    private readonly logger: LoggerInterface,
  ) {}

  start() {
    this.timer = setInterval(() => void this.varrer(), INTERVALO_MS);
    this.timer.unref?.();
    this.acordar();
    this.log(ErrorLevelsEnum.Values.INFO, "in-API spreadsheet importer started", {});
  }

  // waits for the import in progress; past the timeout it is left to the next start's sweep
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.running, new Promise((resolve) => (timeout = setTimeout(resolve, STOP_TIMEOUT_MS)))]);
    clearTimeout(timeout);
  }

  acordar() {
    this.again = true;
    this.running ??= this.consumir().finally(() => (this.running = null));
  }

  private async varrer() {
    try {
      await this.importacoes.devolverTravadas(PRAZO_SECONDS, MAX_TENTATIVAS);
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, "sweeping stuck importacoes", { error: (error as Error).message });
    }
    this.acordar();
  }

  // again: an upload that arrives after the queue looked empty still gets picked up
  private async consumir() {
    while (this.again && !this.stopped) {
      this.again = false;
      try {
        for (;;) {
          if (this.stopped) return;
          const job = await this.importacoes.reivindicar();
          if (!job) break;
          await this.processar(job);
        }
      } catch (error) {
        this.log(ErrorLevelsEnum.Values.ERROR, "claiming importacao", { error: (error as Error).message });
      }
    }
  }

  private async processar(job: ImportacaoJob) {
    const inicio = Date.now();
    const contexto = { importacao: job.id, arquivo: job.nomeArquivo, tentativa: job.tentativas };
    const heartbeat = setInterval(() => {
      this.importacoes.renovar(job).catch((error) =>
        this.log(ErrorLevelsEnum.Values.WARN, "renewing importacao", { ...contexto, error: (error as Error).message }),
      );
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await this.importar(job);
      this.log(ErrorLevelsEnum.Values.INFO, "importacao finished", { ...contexto, duracaoMs: Date.now() - inicio });
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, "processing importacao", { ...contexto, error: causaRaiz(error) });
    } finally {
      clearInterval(heartbeat);
    }
  }

  // takes a claimed job to its final status, or throws leaving it processando
  private async importar(job: ImportacaoJob) {
    let linhas: unknown[][];
    try {
      linhas = semTotais(await lerPlanilha(job.nomeArquivo, job.planilha));
    } catch (error) {
      return this.importacoes.finalizar(job, { status: "falhou", mensagem: (error as Error).message });
    }

    const lidas = await validarEmThreads(linhas);
    const repetidos = skusRepetidos(linhas);
    const validos = lidas.validos.filter(({ linha }) => !repetidos.has(linha));
    const erros = new Map(lidas.erros.map(({ linha, mensagens }) => [linha, mensagens]));
    for (const [linha, mensagem] of repetidos) erros.set(linha, [...(erros.get(linha) ?? []), mensagem]);

    const totalLinhas = validos.length + erros.size;
    if (totalLinhas === 0) {
      return this.importacoes.finalizar(job, { status: "falhou", mensagem: "A planilha não tem nenhum produto." });
    }
    if (totalLinhas > MAX_IMPORT_ROWS) {
      return this.importacoes.finalizar(job, { status: "falhou", mensagem: `Importe no máximo ${MAX_IMPORT_ROWS} produtos por vez.` });
    }

    const result = await this.products.importValidated(validos, job.usuarioId, {
      rowErrors: [...erros].map(([linha, mensagens]) => ({ linha, mensagens })),
      onSaved: (tx, { created, updated }) =>
        this.importacoes.finalizar(job, { status: "concluida", totalLinhas, linhasCriadas: created, linhasAtualizadas: updated }, tx),
    });
    if (result.isLeft()) {
      // 409: a SKU was taken while importing; anything else is ours, not the spreadsheet's
      if (!(result.value instanceof ValidationError)) throw result.value;
      return this.importacoes.finalizar(job, { status: "rejeitada", totalLinhas, mensagem: result.value.message });
    }
    if (result.value.errors.length > 0) {
      const erros = result.value.errors.flatMap(({ linha, mensagens }) =>
        mensagens.map((mensagem) => ({ linha, campo: "", mensagem })),
      );
      return this.importacoes.finalizar(job, { status: "rejeitada", totalLinhas, erros });
    }
  }

  private log(level: ErrorLevel, message: string, extra: object) {
    this.logger.handle({ layer: "queue", worker: this.constructor.name, ...extra }, level, message);
  }
}

export default ImportacaoWorker;
