import "dotenv/config";
import { PgBoss } from "pg-boss";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";

// The API's single pg-boss instance: job queues stored in this same Postgres (schema PGBOSS_SCHEMA,
// "pgboss" by default; pg-boss creates and migrates it on start). In a NestJS app this becomes a
// provider started in onModuleInit and stopped in onModuleDestroy.
class QueueClient {
  readonly boss: PgBoss;
  private started = false;

  constructor(readonly schema = process.env.PGBOSS_SCHEMA || "pgboss") {
    this.boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // same as the app's pool (configs/app_config.ts)
      schema,
      max: 5,
      application_name: "erp-api-queue",
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
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }
}

export const queueClient = new QueueClient();

export default QueueClient;
