import { readFileSync } from "node:fs";
import { apiEnv } from "./database_connection";

// The API's own certificate (secrets/tls/api.crt, or data/certs/api.crt from the launcher):
//
//   API_TLS_CERT  PEM certificate, names api, localhost, 127.0.0.1. Serves HTTPS (TLS 1.3 only) to the
//                 browser and to billing, and is the client certificate the API shows billing
//   API_TLS_KEY   its private key
//   API_TLS_CA    the internal CA: checks the certificates billing presents (CN billing), and billing's
//                 server certificate when the API calls it
//
// All three empty: plain HTTP and no billing link, which API_ENV=production refuses.
const VARS = ["API_TLS_CERT", "API_TLS_KEY", "API_TLS_CA"] as const;

export type ApiTls = { cert: Buffer; key: Buffer; ca: Buffer };

const ler = (key: (typeof VARS)[number]) => {
   const path = process.env[key]!.trim();
   try {
      return readFileSync(path);
   } catch (error) {
      throw new Error(`[config] ${key}: can't read ${path} (${(error as Error).message})`);
   }
};

let cache: ApiTls | null | undefined;

export function apiTls(): ApiTls | null {
   if (cache !== undefined) return cache;
   const definidas = VARS.filter((k) => process.env[k]?.trim());
   if (definidas.length === 0) {
      if (apiEnv() === "production") {
         throw new Error("[config] API_TLS_CERT, API_TLS_KEY and API_TLS_CA are required in production: the API serves TLS 1.3 only");
      }
      return (cache = null);
   }
   if (definidas.length !== VARS.length) {
      throw new Error("[config] set all of API_TLS_CERT, API_TLS_KEY and API_TLS_CA, or none of them");
   }
   return (cache = { cert: ler("API_TLS_CERT"), key: ler("API_TLS_KEY"), ca: ler("API_TLS_CA") });
}
