import { DrizzleDB } from "../db/client";
import { consolidarPendentes, Consolidacao } from "../repositories/audit_trail.repository";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";

// Every AUDITORIAS_INTERVALO_MINUTOS (default 5): turns the queued product and categoria changes
// (alteracoes_pendentes) into automatic auditorias, one lote per user and action (see
// audit_trail.repository). Each batch is its own transaction; on shutdown whatever is queued is flushed.
const LIMITE = 5000;

export const intervaloDeAuditorias = (): number => {
  const minutos = Number(process.env.AUDITORIAS_INTERVALO_MINUTOS);
  return Number.isFinite(minutos) && minutos > 0 ? minutos : 5;
};

class AuditoriaConsolidacaoWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<Consolidacao> | null = null;
  private ultima: Date | null = null;
  private iniciado: Date | null = null;

  constructor(
    private readonly db: DrizzleDB,
    private readonly logger: LoggerInterface,
  ) {}

  start(): void {
    if (this.timer) return;
    this.iniciado = new Date();
    this.timer = setInterval(() => void this.consolidar(), intervaloDeAuditorias() * 60_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
    await this.consolidar();
  }

  // when the last sweep ran and when the next one will, for the Auditorias page
  agenda(): { ultima: string | null; proxima: string | null; intervaloMinutos: number } {
    const intervalo = intervaloDeAuditorias();
    const base = this.ultima ?? this.iniciado;
    return {
      ultima: this.ultima?.toISOString() ?? null,
      proxima: this.timer && base ? new Date(base.getTime() + intervalo * 60_000).toISOString() : null,
      intervaloMinutos: intervalo,
    };
  }

  // also called by "Gerar agora" on the Auditorias page; overlapping calls share the running sweep
  consolidar(): Promise<Consolidacao> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<Consolidacao> {
    const total: Consolidacao = { pendentes: 0, auditorias: 0, lotes: 0 };
    try {
      for (;;) {
        const lote: Consolidacao = await this.db.transaction((tx: DrizzleDB) => consolidarPendentes(tx, LIMITE));
        total.pendentes += lote.pendentes;
        total.auditorias += lote.auditorias;
        total.lotes += lote.lotes;
        if (lote.pendentes < LIMITE) break;
      }
      if (total.pendentes > 0) {
        this.logger.handle({ layer: "queue", worker: "AuditoriaConsolidacaoWorker", ...total }, ErrorLevelsEnum.Values.INFO, "auditorias consolidadas");
      }
    } catch (error) {
      // the database is down or the migration hasn't run: the queue stays and the next sweep tries again
      this.logger.handle({ layer: "queue", worker: "AuditoriaConsolidacaoWorker" }, ErrorLevelsEnum.Values.ERROR, `auditorias: ${(error as Error).message}`);
    } finally {
      this.ultima = new Date();
    }
    return total;
  }
}

export default AuditoriaConsolidacaoWorker;
