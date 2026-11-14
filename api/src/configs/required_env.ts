import "dotenv/config";
import { apiEnv } from "./database_connection";

// Variables the API can't run without. Checked when Config is built (startup): every missing one is
// printed and the process exits with status 1, Node's os.Exit(1), before anything listens. API_ENV,
// DATABASE_URL and the database CA are checked by database_connection.ts the same way.

const ALWAYS: Record<string, string> = {
   JWT_SECRET: "HS256 key for login tokens; generate it with secrets/generate.ts",
};

// their defaults point at localhost, which is only right on a developer's machine
const PRODUCTION: Record<string, string> = {
   CORS_ORIGINS: "the web app's origin(s), comma-separated, e.g. https://erp.example.com",
   WEB_URL: "the web app's address, used in password reset links",
};

export function checkRequiredEnv(): void {
   const required = apiEnv() === "production" ? { ...ALWAYS, ...PRODUCTION } : ALWAYS;
   const missing = Object.entries(required).filter(([key]) => !process.env[key]?.trim());
   if (missing.length === 0) return;
   for (const [key, why] of missing) {
      console.error(`[config] ${key} is required: ${why} (api/.env)`);
   }
   process.exit(1);
}
