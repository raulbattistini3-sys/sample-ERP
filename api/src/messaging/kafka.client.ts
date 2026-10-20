import { Kafka, logLevel, LogEntry, Producer } from "kafkajs";
import { KafkaSettings, jiraIssueTopics, RETRY_TIERS } from "../configs/kafka.config";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";

// kafkajs logs through the app logger (warnings and errors only)
const logCreator = (logger: LoggerInterface) => () => ({ level, log }: LogEntry) => {
  const { message, ...extra } = log;
  logger.handle(
    { layer: "kafka", namespace: log.namespace, ...extra },
    level === logLevel.ERROR ? ErrorLevelsEnum.Values.ERROR : ErrorLevelsEnum.Values.WARN,
    message,
  );
};

// One Kafka connection per API process: the client, a shared idempotent producer (acks=all, so a
// retried send never duplicates a message on the broker), and topic setup.
class KafkaClient {
  readonly kafka: Kafka;
  readonly producer: Producer;
  private producerConnected = false;

  constructor(
    readonly settings: KafkaSettings,
    logger: LoggerInterface,
  ) {
    this.kafka = new Kafka({
      clientId: settings.clientId,
      brokers: settings.brokers,
      logLevel: logLevel.WARN,
      logCreator: logCreator(logger),
    });
    this.producer = this.kafka.producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });
  }

  async connectProducer() {
    if (this.producerConnected) return;
    await this.producer.connect();
    this.producerConnected = true;
  }

  async disconnectProducer() {
    if (!this.producerConnected) return;
    this.producerConnected = false;
    await this.producer.disconnect();
  }

  // creates the Jira issue topics if missing (no-op when they exist)
  async ensureJiraIssueTopics() {
    const topics = jiraIssueTopics(this.settings.topicPrefix);
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const existing = new Set(await admin.listTopics());
      const wanted = [topics.main, ...RETRY_TIERS.map((t) => topics.retry[t.name]), topics.dlq].filter((t) => !existing.has(t));
      if (wanted.length > 0) {
        await admin.createTopics({
          waitForLeaders: true,
          topics: wanted.map((topic) => ({
            topic,
            numPartitions: this.settings.partitions,
            replicationFactor: this.settings.replicationFactor,
            // the dead-letter topic keeps messages for 30 days; the others use the broker default
            ...(topic === topics.dlq && { configEntries: [{ name: "retention.ms", value: String(30 * 24 * 3600 * 1000) }] }),
          })),
        });
      }
      return topics;
    } finally {
      await admin.disconnect();
    }
  }
}

export default KafkaClient;
