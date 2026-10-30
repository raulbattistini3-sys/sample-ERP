import cluster, { Worker } from "node:cluster";
import { extname, join } from "node:path";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { avisarProdutosAlterados, IMPORTACAO_CONCLUIDA } from "../utils/cache/produtos_alterados";

// Each process splits an import across one thread per CPU, so more than one process only pays off for
// several imports at once, and past the CPUs' capacity they compete with each other and with the API.
const PROCESSOS = Number(process.env.IMPORT_PROCESSES) || 1;
const RESTART_MS = 5_000;
const STOP_TIMEOUT_MS = 25_000;

const extensao = extname(__filename);

// The HTTP process's side of the import cluster: keeps the processes that run the imports
// (importacoes.processo.ts) alive and tells them when an upload arrives. A process that dies takes only
// its import with it, and the sweep hands that import back to the queue.
class ImportacaoCluster {
  private processos: Worker[] = [];
  private stopped = false;

  constructor(private readonly logger: LoggerInterface) {}

  start() {
    cluster.setupPrimary({
      exec: join(__dirname, `importacoes.processo${extensao}`),
      // ts-node runs the sources in development, node runs dist/ in production
      execArgv: extensao === ".ts" ? ["-r", "ts-node/register/transpile-only"] : [],
    });
    for (let i = 0; i < PROCESSOS; i++) this.iniciarProcesso();
  }

  acordar() {
    for (const processo of this.processos) if (processo.isConnected()) processo.send("acordar");
  }

  // the processes finish the import in progress; past the timeout it is left to the sweep
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all(
      this.processos.map(
        (processo) =>
          new Promise<void>((resolve) => {
            const timeout = setTimeout(() => processo.kill(), STOP_TIMEOUT_MS);
            processo.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
            if (processo.isConnected()) processo.send("parar");
          }),
      ),
    );
  }

  private iniciarProcesso() {
    const processo = cluster.fork();
    this.processos.push(processo);
    processo.on("message", (mensagem) => {
      if (mensagem === IMPORTACAO_CONCLUIDA) avisarProdutosAlterados();
    });
    processo.once("exit", (code, signal) => {
      this.processos = this.processos.filter((p) => p !== processo);
      if (this.stopped) return;
      this.logger.handle(
        { layer: "queue", cluster: this.constructor.name, code, signal },
        ErrorLevelsEnum.Values.ERROR,
        `import process died, restarting in ${RESTART_MS / 1000}s`,
      );
      setTimeout(() => this.iniciarProcesso(), RESTART_MS).unref?.();
    });
  }
}

export default ImportacaoCluster;
