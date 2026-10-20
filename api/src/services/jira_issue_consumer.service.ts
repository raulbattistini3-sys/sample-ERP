import { Consumer, EachBatchPayload, Kafka, Producer } from "kafkajs";
import JiraOutboxRepository, { OutboxMessage } from "../repositories/jira_outbox.repository";
import IntegracaoService from "./integracao.service";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum, { type ErrorLevelsEnum as ErrorLevel } from "../enums/errors_enums/errors_levels.enum";
import { RETRY_TIERS, jiraIssueTopics } from "../configs/kafka.config";
import { MAX_ATTEMPTS, buildAuditoriaIssue, retryTierFor } from "./jira_issue_content";

// a consumer that claimed a row owns it this long; past it, the relay publishes it again
const LEASE_MINUTES = 5;

type Topics = ReturnType<typeof jiraIssueTopics>;

// Consumer group that turns the messages into Jira issues. It reads the main topic and the three
// retry topics. A failed send goes to the retry topic for its delay (1, 5, then 30 min) with a
// 'retry-at' header; after MAX_ATTEMPTS it goes to the dead-letter topic. The outbox row is claimed
// atomically before calling Jira, so a message delivered twice never creates two issues.
class JiraIssueConsumer {
  private readonly consumer: Consumer;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    kafka: Kafka,
    groupId: string,
    private readonly topics: Topics,
    private readonly producer: Pick<Producer, "send">,
    private readonly outbox: JiraOutboxRepository,
    private readonly integracaoService: IntegracaoService,
    private readonly logger: LoggerInterface,
  ) {
    this.consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  }

  async start() {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [this.topics.main, ...RETRY_TIERS.map((t) => this.topics.retry[t.name])] });
    await this.consumer.run({
      // offsets are resolved by hand: a retry that isn't due yet must not be marked as consumed
      eachBatchAutoResolve: false,
      eachBatch: (payload) => this.eachBatch(payload),
    });
  }

  async stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.consumer.disconnect();
  }

  private async eachBatch({ batch, resolveOffset, heartbeat, pause, isRunning, isStale }: EachBatchPayload) {
    for (const message of batch.messages) {
      if (!isRunning() || isStale()) return;

      // retry topics: everything in a topic waits the same, so if this one isn't due, the rest of the
      // partition isn't either. Pause it, rewind to this message, and resume when it's due.
      const retryAt = Number(message.headers?.["retry-at"]?.toString() ?? 0);
      const waitMs = retryAt - Date.now();
      if (waitMs > 0) {
        const resume = pause();
        this.consumer.seek({ topic: batch.topic, partition: batch.partition, offset: message.offset });
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          resume();
        }, waitMs);
        this.timers.add(timer);
        return;
      }

      let payload: OutboxMessage | null = null;
      try {
        payload = JSON.parse(message.value?.toString() ?? "null");
      } catch {
        payload = null;
      }
      if (payload?.outboxId) {
        // an exception here (database down...) leaves the offset unresolved: kafkajs retries the message
        await this.handle(payload);
      } else {
        this.log(ErrorLevelsEnum.Values.WARN, "ignored a message that isn't an outbox row", { topic: batch.topic, offset: message.offset });
      }
      resolveOffset(message.offset);
      await heartbeat();
    }
  }

  async handle(message: OutboxMessage) {
    const item = await this.outbox.claimForSend(message.outboxId, LEASE_MINUTES);
    if (!item) return; // already sent, being sent elsewhere, or cancelled
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
    if (item.tentativas >= MAX_ATTEMPTS) {
      await this.producer.send({
        topic: this.topics.dlq,
        acks: -1,
        messages: [{ key: item.auditoriaId, value: JSON.stringify(message), headers: { "outbox-id": item.id, tentativas: String(item.tentativas), erro: error.slice(0, 500) } }],
      });
      await this.outbox.markFailed(item.id, error, null);
      this.log(ErrorLevelsEnum.Values.ERROR, `jira issue gave up after ${item.tentativas} attempts: ${error}`, { auditoriaId: item.auditoriaId, categoria: item.categoriaNome });
      return;
    }

    const tier = retryTierFor(item.tentativas);
    await this.producer.send({
      topic: this.topics.retry[tier.name],
      acks: -1,
      messages: [{
        key: item.auditoriaId,
        value: JSON.stringify(message),
        headers: { "outbox-id": item.id, tentativas: String(item.tentativas), "retry-at": String(Date.now() + tier.delayMs) },
      }],
    });
    await this.outbox.markFailed(item.id, error, tier.delayMs);
    this.log(ErrorLevelsEnum.Values.WARN, `jira issue not created, retry in ${tier.name}: ${error}`, { auditoriaId: item.auditoriaId, categoria: item.categoriaNome, tentativas: item.tentativas });
  }

  private log(level: ErrorLevel, message: string, extra: object) {
    this.logger.handle({ layer: "consumer", consumer: this.constructor.name, ...extra }, level, message);
  }
}

export default JiraIssueConsumer;
