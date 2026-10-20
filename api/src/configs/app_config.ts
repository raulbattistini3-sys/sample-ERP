import "dotenv/config";
import { drizzle, NodePgClient, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";

export type ApiConfig = {
  port: number;
  host: string;
};

class Config {
  private appConfig: { api: ApiConfig };
  private static instance: Config;
  private db?: NodePgDatabase<typeof schema>;
  
  constructor() {
    this.appConfig = { api: this.loadApiConfig() };
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private loadApiConfig(): ApiConfig {
    return {
      port: Number(process.env.APP_PORT) || 3333,
      host: process.env.APP_HOST || "localhost",
    };
  }

  public getApiConfig(): ApiConfig {
    return this.appConfig.api;
  }

  public getDb(): NodePgDatabase<typeof schema> {
    if (!this.db) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      this.db = drizzle(pool, { schema });
    }
    return this.db;
  }
}

export default Config;
