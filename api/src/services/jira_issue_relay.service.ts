import { Producer } from "kafkajs";
import JiraOutboxRepository from "../repositories/jira_outbox.repository";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum, { type ErrorLevelsEnum as ErrorLevel } from "../enums/errors_enums/errors_levels.enum";
import { MAX_ATTEMPTS } from "./jira_issue_content";

const BATCH_SIZE = 50;
const MAX_BATCHES_PER_RUN = 10;
// a published row that hasn't been picked up within this window is published again
const PUBLISH_WINDOW_MINUTES = 15;
const POLL_MS = 2_000;

// Outbox relay: moves rows from auditoria_jira_issues (written in the auditorias' transactions) onto
// the Kafka topic. Polls every 2s; safe with several API instances (SKIP LOCKED). If Kafka is down,
// the rows go back to 'pendente' and are tried again on the next tick: nothing is lost.
class JiraIssueRelay {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly outbox: JiraOutboxRepository,
    private readonly producer: Pick<Producer, "send">,
    private readonly topic: string,
    private readonly logger: LoggerInterface,
    private readonly pollMs = POLL_MS,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.pollMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let published = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
        const rows = await this.outbox.claimForPublish(BATCH_SIZE, MAX_ATTEMPTS, PUBLISH_WINDOW_MINUTES);
        if (rows.length === 0) break;
        try {
          await this.producer.send({
            topic: this.topic,
            acks: -1,
            // keyed by auditoria: its issues land on the same partition, in order
            messages: rows.map((row) => ({ key: row.auditoriaId, value: JSON.stringify(row), headers: { "outbox-id": row.outboxId } })),
          });
          published += rows.length;
        } catch (error) {
          await this.outbox.releaseUnpublished(rows.map((r) => r.outboxId));
          this.log(ErrorLevelsEnum.Values.WARN, "jira issues not published, will retry", { count: rows.length, error: (error as Error).message });
          break;
        }
        if (rows.length < BATCH_SIZE) break;
      }
    } catch (error) {
      this.log(ErrorLevelsEnum.Values.ERROR, "jira relay run failed", { error: (error as Error).message });
    } finally {
      this.running = false;
    }
    return published;
  }

  private log(level: ErrorLevel, message: string, extra: object) {
    this.logger.handle({ layer: "relay", relay: this.constructor.name, topic: this.topic, ...extra }, level, message);
  }
}

export default JiraIssueRelay;
