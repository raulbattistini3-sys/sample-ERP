import "dotenv/config";
import { DrizzleDB } from "../db/client";
import { drizzle } from "drizzle-orm/node-postgres";
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
    console.log("testh")
    return {
      port: Number(process.env.APP_PORT) || 3333,
      host: String(process.env.APP_HOST) || "localhost",
    };
  }

  public getApiConfig(): ApiConfig {
    return this.appConfig.api;
  }

  public getDb(): DrizzleDB {
  const pool = new Pool({
    database: "app_dev", // process.env.DB_NAME,
    host: "localhost",// process.env.DB_HOST,
    port: 3306, // Number(process.env.DB_PORT) || 3306,
    user: "root",// process.env.DB_USERNAME,
  });
  const db = drizzle(pool, { schema });
  return db;
  }
}

export default Config;
