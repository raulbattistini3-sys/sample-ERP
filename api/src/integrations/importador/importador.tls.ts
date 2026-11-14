import { readFileSync } from "node:fs";
import { ChannelCredentials, ChannelOptions, credentials } from "@grpc/grpc-js";
import { apiEnv } from "../../configs/database_connection";

// Mutual TLS to the Go importer: the API checks the importer's certificate against IMPORTER_TLS_CA and
// presents its own (IMPORTER_TLS_CERT/KEY), which the importer checks against its GRPC_TLS_CLIENT_CA.
// secrets/generate.ts writes all of them (secrets/tls/); the launcher makes its own in data/certs.
//
//   IMPORTER_TLS_CA           PEM CA that signed the importer's certificate
//   IMPORTER_TLS_CERT         PEM client certificate of this API
//   IMPORTER_TLS_KEY          its private key
//   IMPORTER_TLS_SERVER_NAME  the name the importer's certificate must hold; "importer" by default. It is
//                             checked whatever address was dialled (127.0.0.1 from the launcher, whatever
//                             the network service hands out), and TLS can't send an IP as SNI anyway.
//
// All three files empty means plaintext, which is refused when API_ENV=production.
const VARS = ["IMPORTER_TLS_CA", "IMPORTER_TLS_CERT", "IMPORTER_TLS_KEY"] as const;

const ler = (key: (typeof VARS)[number]) => {
   const path = process.env[key]!.trim();
   try {
      return readFileSync(path);
   } catch (error) {
      throw new Error(`[config] ${key}: can't read ${path} (${(error as Error).message})`);
   }
};

export type ImportadorTransporte = { credenciais: ChannelCredentials; opcoes: ChannelOptions; mtls: boolean };

export function importadorTransporte(): ImportadorTransporte {
   const definidas = VARS.filter((key) => process.env[key]?.trim());
   if (definidas.length === 0) {
      if (apiEnv() === "production") {
         throw new Error(
            "[config] IMPORTER_TLS_CA, IMPORTER_TLS_CERT and IMPORTER_TLS_KEY are required in production: the importer only accepts mutual TLS",
         );
      }
      return { credenciais: credentials.createInsecure(), opcoes: {}, mtls: false };
   }
   if (definidas.length !== VARS.length) {
      throw new Error("[config] set all of IMPORTER_TLS_CA, IMPORTER_TLS_CERT and IMPORTER_TLS_KEY, or none of them");
   }
   const credenciais = credentials.createSsl(ler("IMPORTER_TLS_CA"), ler("IMPORTER_TLS_KEY"), ler("IMPORTER_TLS_CERT"));
   const nome = process.env.IMPORTER_TLS_SERVER_NAME?.trim() || "importer";
   const opcoes: ChannelOptions = { "grpc.ssl_target_name_override": nome, "grpc.default_authority": nome };
   return { credenciais, opcoes, mtls: true };
}
