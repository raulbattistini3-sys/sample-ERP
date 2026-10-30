import { JobWithMetadata } from "pg-boss";
import IntegracaoEnviosRepository, { QueuedEnvio } from "../repositories/integracao_envios.repository";
import { Provider } from "../configs/oauth.providers";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum, { type ErrorLevelsEnum as ErrorLevel } from "../enums/errors_enums/errors_levels.enum";
import { BaseAppError } from "../errors/global_error.error";
import { Either } from "../globals/errors/left_right_either.error";
import QueueClient from "./queue.client";
import { ENVIO_QUEUES, EnvioJob, JOB_EXPIRE_SECONDS, MAX_ATTEMPTS, approxRetryDelayMs, envioQueueOptions } from "./integracao_envios.jobs";

// creates the issue/ticket of one row in a provider; returns its id/key and link
export type EnvioSender = (envio: QueuedEnvio) => Promise<Either<BaseAppError, { key: string; url: string }>>;

// shorter than the job's expiry, so when pg-boss hands an expired job to another worker, that worker
// can claim the row (a worker that is still alive has had time to finish or fail)
const LEASE_MINUTES = Math.floor(JOB_EXPIRE_SECONDS / 60) - 1;
const SWEEP_MS = 5 * 60_000;
const RESTART_MS = 30_000;

// Runs the "create this issue/ticket" jobs of every provider's queue. A failure throws, so pg-boss retries
// the job with backoff; after the last attempt pg-boss moves it to the provider's dead-letter queue.
// In a NestJS app this becomes the queues' worker provider.
class IntegracaoEnvioWorker {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly queue: QueueClient,
    private readonly envios: IntegracaoEnviosRepository,
    private readonly senders: Record<Provider, EnvioSender>,
    private readonly logger: LoggerInterface,
  ) {}

  // If the database or the pg-boss schema isn't reachable at startup, the API keeps serving (rows saved
  // meanwhile wait without a job) and this keeps trying every 30s.
  async start(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.queue.start(this.logger);
      for (const provider of Object.keys(ENVIO_QUEUES) as Provider[]) {
        const { queue, dlq } = ENVIO_QUEUES[provider];
        await this.queue.boss.createQueue(dlq);
        await this.queue.boss.createQueue(queue, envioQueueOptions(provider));
        await this.queue.boss.updateQueue(queue, envioQueueOptions(provider)); // keeps options current on existing queues
        await this.queue.boss.work(
          queue,
          { batchSize: 1, localConcurrency: 3, pollingIntervalSeconds: 2, includeMetadata: true } as const,
          async ([job]: JobWithMetadata<EnvioJob>[]) => this.handle(job),
        );
      }
      await this.enqueueMissing();
      this.sweepTimer = setInterval(() => void this.enqueueMissing(), SWEEP_MS);
      this.sweepTimer.unref?.();
      this.log(ErrorLevelsEnum.Values.INFO, "integration worker started", { schema: this.queue.schema, queues: ENVIO_QUEUES });
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, `integration queue unavailable, retrying in ${RESTART_MS / 1000}s`, { error: (error as Error).message });
      this.restartTimer = setTimeout(() => void this.start(), RESTART_MS);
      this.restartTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    await this.queue.stop().catch(() => {});
  }

  // rows without a job (saved while the queue wasn't running, or reset by "Reenviar") get one
  async enqueueMissing(): Promise<number> {
    if (!this.queue.isStarted) return 0;
    let total = 0;
    try {
      for (;;) {
        const ids = await this.envios.listWithoutJob(100);
        if (ids.length === 0) break;
        const enqueued = await this.envios.enqueueJobs(ids);
        total += enqueued;
        if (enqueued === 0 || ids.length < 100) break;
      }
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, "could not enqueue pending integration rows", { error: (error as Error).message });
    }
    return total;
  }

  async handle(job: JobWithMetadata<EnvioJob>): Promise<void> {
    const envio = await this.envios.claimForSend(job.data.envioId, LEASE_MINUTES);
    if (!envio) return; // already sent, being sent by another run, or cancelled: the job completes
    if (envio.auditoriaRemovida) {
      await this.envios.markCancelled(envio.id);
      return;
    }

    const result = await this.senders[envio.provider](envio);
    if (result.isRight()) {
      await this.envios.markSent(envio.id, result.value.key, result.value.url);
      return;
    }

    const error = result.value.message;
    const lastAttempt = job.retryCount >= job.retryLimit;
    await this.envios.markFailed(envio.id, error, lastAttempt ? null : approxRetryDelayMs(job.retryCount));
    this.log(
      lastAttempt ? ErrorLevelsEnum.Values.ERROR : ErrorLevelsEnum.Values.WARN,
      lastAttempt ? `${envio.provider}: gave up after ${MAX_ATTEMPTS} attempts: ${error}` : `${envio.provider}: not created, will retry: ${error}`,
      { provider: envio.provider, auditoriaId: envio.auditoriaId, categoria: envio.categoriaNome, attempt: job.retryCount + 1 },
    );
    throw new Error(error); // pg-boss: retry with backoff, or the dead-letter queue after the last attempt
  }

  private log(level: ErrorLevel, message: string, extra: object) {
    this.logger.handle({ layer: "queue", worker: this.constructor.name, ...extra }, level, message);
  }
}

export default IntegracaoEnvioWorker;
