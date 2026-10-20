import "dotenv/config";

// Kafka connection and the topics of the Jira issue pipeline:
//   <prefix>.jira-issues            new issues, published by the outbox relay
//   <prefix>.jira-issues.retry.1m   failed sends, retried after 1 / 5 / 30 minutes: one topic per delay,
//   <prefix>.jira-issues.retry.5m   so every message in a topic waits the same and they become due in
//   <prefix>.jira-issues.retry.30m  order (a shared retry topic would let a 30m wait block a 1m one)
//   <prefix>.jira-issues.dlq        gave up after MAX_ATTEMPTS (kept for inspection/replay)
export type KafkaSettings = {
  brokers: string[];
  clientId: string;
  topicPrefix: string;
  partitions: number;
  replicationFactor: number;
};

export const kafkaSettings = (): KafkaSettings => ({
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(",").map((b) => b.trim()).filter(Boolean),
  clientId: process.env.KAFKA_CLIENT_ID || "erp-api",
  topicPrefix: process.env.KAFKA_TOPIC_PREFIX || "erp",
  partitions: Number(process.env.KAFKA_PARTITIONS || 3),
  replicationFactor: Number(process.env.KAFKA_REPLICATION_FACTOR || 1),
});

export const RETRY_TIERS = [
  { name: "1m", delayMs: 60_000 },
  { name: "5m", delayMs: 5 * 60_000 },
  { name: "30m", delayMs: 30 * 60_000 },
] as const;

export type RetryTier = (typeof RETRY_TIERS)[number];

export const jiraIssueTopics = (prefix: string) => ({
  main: `${prefix}.jira-issues`,
  retry: Object.fromEntries(RETRY_TIERS.map((t) => [t.name, `${prefix}.jira-issues.retry.${t.name}`])) as Record<RetryTier["name"], string>,
  dlq: `${prefix}.jira-issues.dlq`,
});

export const jiraIssuesConsumerGroup = (prefix: string) => `${prefix}.jira-issues.consumer`;
