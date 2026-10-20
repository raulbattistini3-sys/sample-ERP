import { JobWithMetadata } from "pg-boss";
import JiraOutboxRepository from "../repositories/jira_outbox.repository";
import IntegracaoService from "../services/integracao.service";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum, { type ErrorLevelsEnum as ErrorLevel } from "../enums/errors_enums/errors_levels.enum";
import { buildAuditoriaIssue } from "../services/jira_issue_content";
import QueueClient from "./queue.client";
import {
  JIRA_ISSUES_DLQ,
  JIRA_ISSUES_QUEUE,
  JOB_EXPIRE_SECONDS,
  JiraIssueJob,
  MAX_ATTEMPTS,
  approxRetryDelayMs,
  jiraIssuesQueueOptions,
} from "./jira_issues.jobs";

// shorter than the job's expiry, so when pg-boss hands an expired job to another worker, that worker
// can claim the row (a worker that is still alive has had time to finish or fail)
const LEASE_MINUTES = Math.floor(JOB_EXPIRE_SECONDS / 60) - 1;
const SWEEP_MS = 5 * 60_000;
const RESTART_MS = 30_000;

// Runs the "create this Jira issue" jobs. A failure throws, so pg-boss retries the job with backoff;
// after the last attempt pg-boss moves it to the dead-letter queue. In a NestJS app this becomes the
// queue's worker provider.
class JiraIssueWorker {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly queue: QueueClient,
    private readonly outbox: JiraOutboxRepository,
    private readonly integracaoService: IntegracaoService,
    private readonly logger: LoggerInterface,
  ) {}

  // If the database or the pg-boss schema isn't reachable at startup, the API keeps serving (rows saved
  // meanwhile wait without a job) and this keeps trying every 30s.
  async start(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.queue.start(this.logger);
      await this.queue.boss.createQueue(JIRA_ISSUES_DLQ);
      await this.queue.boss.createQueue(JIRA_ISSUES_QUEUE, jiraIssuesQueueOptions);
      await this.queue.boss.updateQueue(JIRA_ISSUES_QUEUE, jiraIssuesQueueOptions); // keeps options current on existing queues
      await this.queue.boss.work(
        JIRA_ISSUES_QUEUE,
        { batchSize: 1, localConcurrency: 3, pollingIntervalSeconds: 2, includeMetadata: true } as const,
        async ([job]: JobWithMetadata<JiraIssueJob>[]) => this.handle(job),
      );
      await this.enqueueMissing();
      this.sweepTimer = setInterval(() => void this.enqueueMissing(), SWEEP_MS);
      this.sweepTimer.unref?.();
      this.log(ErrorLevelsEnum.Values.INFO, "jira issue worker started", { schema: this.queue.schema, queue: JIRA_ISSUES_QUEUE });
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, `jira issue queue unavailable, retrying in ${RESTART_MS / 1000}s`, { error: (error as Error).message });
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
        const ids = await this.outbox.listWithoutJob(100);
        if (ids.length === 0) break;
        const enqueued = await this.outbox.enqueueJobs(ids);
        total += enqueued;
        if (enqueued === 0 || ids.length < 100) break;
      }
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, "could not enqueue pending jira issues", { error: (error as Error).message });
    }
    return total;
  }

  async handle(job: JobWithMetadata<JiraIssueJob>): Promise<void> {
    const item = await this.outbox.claimForSend(job.data.outboxId, LEASE_MINUTES);
    if (!item) return; // already sent, being sent by another run, or cancelled: the job completes
    if (item.auditoriaRemovida) {
      await this.outbox.markCancelled(item.id);
      return;
    }

    const result = await this.integracaoService.createJiraIssue(buildAuditoriaIssue(item));
    if (result.isRight()) {
      await this.outbox.markSent(item.id, result.value.key, result.value.url);
      return;
    }

    const error = result.value.message;
    const lastAttempt = job.retryCount >= job.retryLimit;
    await this.outbox.markFailed(item.id, error, lastAttempt ? null : approxRetryDelayMs(job.retryCount));
    this.log(
      lastAttempt ? ErrorLevelsEnum.Values.ERROR : ErrorLevelsEnum.Values.WARN,
      lastAttempt ? `jira issue gave up after ${MAX_ATTEMPTS} attempts: ${error}` : `jira issue not created, will retry: ${error}`,
      { auditoriaId: item.auditoriaId, categoria: item.categoriaNome, attempt: job.retryCount + 1 },
    );
    throw new Error(error); // pg-boss: retry with backoff, or the dead-letter queue after the last attempt
  }

  private log(level: ErrorLevel, message: string, extra: object) {
    this.logger.handle({ layer: "queue", worker: this.constructor.name, ...extra }, level, message);
  }
}

export default JiraIssueWorker;
