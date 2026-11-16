import "dotenv/config";
import { PgBoss } from "pg-boss";
import { databaseConnection } from "../configs/database_connection";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { processRole } from "../configs/process_role";

const STOP_TIMEOUT_MS = 10_000;

// The API's single pg-boss instance: job queues stored in this same Postgres (schema PGBOSS_SCHEMA,
// "pgboss" by default; pg-boss creates and migrates it on start). In a NestJS app this becomes a
// provider started in onModuleInit and stopped in onModuleDestroy.
class QueueClient {
  readonly boss: PgBoss;
  private started = false;

  constructor(readonly schema = process.env.PGBOSS_SCHEMA || "pgboss") {
    const { connectionString, ssl } = databaseConnection(); // same TLS as the app's pool
    // API_ROLE=api only produces: its instance neither supervises (maintenance, expiry) nor runs the cron
    // scheduler, which the worker process owns; a small pool is enough for send() in the API's transactions
    const producerOnly = processRole() === "api";
    this.boss = new PgBoss({
      connectionString,
      ssl,
      schema,
      max: producerOnly ? 2 : 5,
      supervise: !producerOnly,
      schedule: !producerOnly,
      application_name: producerOnly ? "erp-api-queue" : "erp-worker-queue",
    });
  }

  get isStarted() {
    return this.started;
  }

  async start(logger: LoggerInterface) {
    if (this.started) return;
    this.boss.on("error", (error) =>
      logger.handle({ layer: "queue", schema: this.schema, error: error.message }, ErrorLevelsEnum.Values.ERROR, "pg-boss error"),
    );
    await this.boss.start();
    this.started = true;
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    // inside polyvisor's stop grace (15s) and the launcher's (20s): past it the process tree is killed and
    // a running job would only come back after its expiry (5 min)
    await this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  }
}

export const queueClient = new QueueClient();

export default QueueClient;
