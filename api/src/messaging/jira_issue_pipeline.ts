import KafkaClient from "./kafka.client";
import JiraIssueRelay from "../services/jira_issue_relay.service";
import JiraIssueConsumer from "../services/jira_issue_consumer.service";
import JiraOutboxRepository from "../repositories/jira_outbox.repository";
import IntegracaoService from "../services/integracao.service";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { jiraIssueTopics, jiraIssuesConsumerGroup } from "../configs/kafka.config";

const RECONNECT_MS = 30_000;

// auditoria_jira_issues (outbox) -> relay -> Kafka -> consumer group -> Jira.
// If Kafka is unreachable at startup, the API keeps serving (auditorias still queue their issues in
// the outbox) and the pipeline keeps trying to start every 30s.
class JiraIssuePipeline {
  readonly topics: ReturnType<typeof jiraIssueTopics>;
  readonly relay: JiraIssueRelay;
  readonly consumer: JiraIssueConsumer;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private stopped = false;

  constructor(
    private readonly client: KafkaClient,
    outbox: JiraOutboxRepository,
    integracaoService: IntegracaoService,
    private readonly logger: LoggerInterface,
  ) {
    this.topics = jiraIssueTopics(client.settings.topicPrefix);
    this.relay = new JiraIssueRelay(outbox, client.producer, this.topics.main, logger);
    this.consumer = new JiraIssueConsumer(
      client.kafka,
      jiraIssuesConsumerGroup(client.settings.topicPrefix),
      this.topics,
      client.producer,
      outbox,
      integracaoService,
      logger,
    );
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    try {
      await this.client.ensureJiraIssueTopics();
      await this.client.connectProducer();
      await this.consumer.start();
      this.relay.start();
      this.started = true;
      this.logger.handle({ layer: "kafka", brokers: this.client.settings.brokers, topics: this.topics }, ErrorLevelsEnum.Values.INFO, "jira issue pipeline started");
    } catch (error) {
      this.logger.handle(
        { layer: "kafka", brokers: this.client.settings.brokers, error: (error as Error).message },
        ErrorLevelsEnum.Values.ERROR,
        `kafka unavailable, jira issues stay queued; retrying in ${RECONNECT_MS / 1000}s`,
      );
      this.retryTimer = setTimeout(() => void this.start(), RECONNECT_MS);
      this.retryTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.relay.stop();
    await this.consumer.stop().catch(() => {});
    await this.client.disconnectProducer().catch(() => {});
  }
}

export default JiraIssuePipeline;
