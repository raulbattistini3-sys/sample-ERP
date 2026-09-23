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
      host: String(process.env.APP_HOST) || "localhost",
    };
  }

  public getApiConfig(): ApiConfig {
    return this.appConfig.api;
  }

  public getDb(): NodePgDatabase | any {
  const pool = new Pool({
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME,
  });
  const db = drizzle(pool, { schema });
  return db;
  }
}

export default Config;
