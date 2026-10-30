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
    // Render sets PORT and RENDER; it only routes to 0.0.0.0, so APP_HOST is ignored there
    // (a copied APP_HOST=localhost would leave Render scanning for an open port until it gives up)
    return {
      port: Number(process.env.PORT || process.env.APP_PORT) || 10000,
      host: process.env.RENDER ? "0.0.0.0" : process.env.APP_HOST || "0.0.0.0",
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
