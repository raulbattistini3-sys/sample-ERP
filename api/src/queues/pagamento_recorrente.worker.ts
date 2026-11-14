import PagamentoRecorrenteRepository from "../repositories/pagamento_recorrente.repository";
import PagamentoRecorrenteService from "../services/pagamento_recorrente.service";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";

// Every minute: leases the active plans due today (pagamentos_recorrentes), charges each one's cycle and
// moves it on. The lease (bloqueado_ate) is what keeps two API instances, or a sweep that overlaps a slow
// one, off the same plan; a crashed instance's lease simply runs out and the next sweep takes it again.
// Stripe and the e-mail are idempotent per cycle, so a cycle taken twice still bills once.
const SWEEP_MS = 60_000;
const LOTE = 10;
const LEASE_MINUTOS = 10; // above billing's 120s timeout × the batch, so a lease never ends mid-charge

class PagamentoRecorrenteWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly planos: PagamentoRecorrenteRepository,
    private readonly service: PagamentoRecorrenteService,
    private readonly logger: LoggerInterface,
  ) {}

  start(): void {
    if (this.timer || process.env.PAGAMENTOS_RECORRENTES_DESLIGADOS === "true") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
    void this.sweep();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  private sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    try {
      for (;;) {
        const devidos = await this.planos.reservarDevidos(LOTE, LEASE_MINUTOS);
        for (const plano of devidos) {
          const resultado = await this.service.executar(plano);
          this.logger.handle(
            { layer: "queue", worker: "PagamentoRecorrenteWorker", pagamentoId: plano.id, ciclo: plano.proximoCiclo, resultado },
            ErrorLevelsEnum.Values.INFO,
            "ciclo de pagamento recorrente",
          );
        }
        if (devidos.length < LOTE || !this.timer) return;
      }
    } catch (error) {
      // the database is down or the migration hasn't run: the next sweep tries again
      this.logger.handle({ layer: "queue", worker: "PagamentoRecorrenteWorker" }, ErrorLevelsEnum.Values.ERROR, `pagamentos recorrentes: ${(error as Error).message}`);
    }
  }
}

export default PagamentoRecorrenteWorker;
