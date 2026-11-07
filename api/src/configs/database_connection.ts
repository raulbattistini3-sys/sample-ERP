import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ConnectionOptions } from "node:tls";

// How every Postgres client of the API connects (the app's pool, pg-boss, drizzle-kit, the scripts),
// decided by API_ENV:
//
//   production   TLS, with the server's certificate verified against DATABASE_CA_CERT, or else
//                prod-ca-2021.crt (Supabase's root CA, in the repo root) found from the working directory
//                upwards, like the importer and billing do. No CA, or sslmode=disable in
//                DATABASE_URL, stops the process: an unverified connection can be intercepted (MITM).
//   development  plain TCP (a local Postgres has no TLS), unless DATABASE_CA_CERT is set, in which case
//                it is verified like production.
//
// Anything else in API_ENV, or no API_ENV at all, stops the process too: choosing is required.

export const API_ENVS = ["production", "development"] as const;
export type ApiEnv = (typeof API_ENVS)[number];

export type DatabaseConnection = {
   apiEnv: ApiEnv;
   // DATABASE_URL without its ssl* parameters: node-postgres lets those override the ssl option below
   connectionString: string;
   ssl: false | ConnectionOptions;
};

const DEFAULT_CA_CERT = "prod-ca-2021.crt";
// api/, the repo root, and one more
const CA_SEARCH_DEPTH = 3;
const INSECURE_SSLMODES = new Set(["disable", "allow", "prefer", "no-verify"]);

// The configuration is wrong and nothing can run: say why and exit with status 1, Node's os.Exit(1).
// Safe here because it runs at startup, before any server, pool or timer exists.
function fatal(message: string): never {
   console.error(`[config] ${message}`);
   process.exit(1);
}

export function apiEnv(): ApiEnv {
   const value = process.env.API_ENV?.trim().toLowerCase();
   if (!value) {
      fatal(`API_ENV is not set; use ${API_ENVS.join(" or ")} (api/.env)`);
   }
   if (!API_ENVS.includes(value as ApiEnv)) {
      fatal(`API_ENV="${process.env.API_ENV}" is not valid; use ${API_ENVS.join(" or ")}`);
   }
   return value as ApiEnv;
}

let cached: DatabaseConnection | undefined;

export function databaseConnection(): DatabaseConnection {
   if (cached) return cached;

   const env = apiEnv();
   const raw = process.env.DATABASE_URL;
   if (!raw) {
      fatal("DATABASE_URL is not set (api/.env)");
   }
   let url: URL;
   try {
      url = new URL(raw);
   } catch {
      fatal("DATABASE_URL is not a valid postgresql:// URL");
   }

   const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
   for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("ssl") || key === "uselibpqcompat") url.searchParams.delete(key);
   }

   let caPath = process.env.DATABASE_CA_CERT?.trim() ?? "";
   if (!caPath && env === "production") {
      caPath = findUpwards(DEFAULT_CA_CERT);
      if (!caPath) fatal(`API_ENV=production needs the database CA: put ${DEFAULT_CA_CERT} in the repo root or set DATABASE_CA_CERT`);
   }
   let ssl: DatabaseConnection["ssl"] = false;
   if (env === "production") {
      if (sslmode && INSECURE_SSLMODES.has(sslmode)) {
         fatal(`DATABASE_URL has sslmode=${sslmode}, but API_ENV=production requires verified TLS; remove it`);
      }
      ssl = { ca: readCa(caPath), rejectUnauthorized: true };
   } else if (caPath) {
      ssl = { ca: readCa(caPath), rejectUnauthorized: true };
   }

   cached = { apiEnv: env, connectionString: url.toString(), ssl };
   return cached;
}

function findUpwards(name: string): string {
   let dir = process.cwd();
   for (let i = 0; i <= CA_SEARCH_DEPTH; i++) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
   }
   return "";
}

// relative paths are from the working directory (api/ for bun run, the Render service root)
function readCa(path: string): string {
   const full = resolve(path);
   try {
      const pem = readFileSync(full, "utf8");
      if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
         fatal(`DATABASE_CA_CERT (${full}) is not a PEM certificate`);
      }
      return pem;
   } catch (error) {
      fatal(`cannot read the database CA certificate ${full}: ${(error as Error).message}`);
   }
}

// drizzle-kit takes either a bare url (no TLS options) or separate fields with ssl, so the TLS choice
// above can only reach it in the second form
export function drizzleKitCredentials() {
   const { connectionString, ssl } = databaseConnection();
   const url = new URL(connectionString);
   return {
      host: url.hostname,
      port: Number(url.port) || 5432,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)) || "postgres",
      ssl,
   };
}
