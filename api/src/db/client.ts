import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  database: "app_dev", // process.env.DB_NAME,
  host: "localhost",// process.env.DB_HOST,
  port: 3306, // Number(process.env.DB_PORT) || 3306,
  user: "root",// process.env.DB_USERNAME,
});
  console.log("pool", pool)

export const db = drizzle(pool, { schema });
console.log("teste")
export type DrizzleDB = typeof db;
