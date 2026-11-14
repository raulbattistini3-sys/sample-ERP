import { readFileSync } from "node:fs";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { request as httpRequest } from "node:http";
import { apiEnv } from "../../configs/database_connection";

// The API's way into the vault (vault/, Go): the sensitive fields of ERP rows, encrypted in the vault's
// own database and keyed by owner type + the row's id here (owner_type "usuario", owner_id = usuarios.id).
//
//   VAULT_URL                 https://vault:8200 (compose) / https://127.0.0.1:<port> (launcher). Empty:
//                             no vault, and a payload carrying cpf/dataNascimento is refused with 503
//   VAULT_TOKEN               the bearer token (secrets/vault_token); the vault keeps only its SHA-256
//   VAULT_TLS_CA              PEM CA that signed the vault's certificate (secrets/tls/ca.crt)
//   VAULT_TLS_CERT / _KEY     this API's client certificate (the same one it shows the importer)
//   VAULT_TLS_SERVER_NAME     the name the vault's certificate must hold; "vault" by default
//
// Plain http (no VAULT_TLS_*) is refused when API_ENV=production.

export type VaultDados = Record<string, string>;
export type VaultRecord = { owner_type: string; owner_id: string; data: VaultDados; masked: boolean; updated_at: string };

export class VaultIndisponivel extends Error {}
export class VaultConflito extends Error {}

type Resposta = { status: number; body: unknown };

const TLS_VARS = ["VAULT_TLS_CA", "VAULT_TLS_CERT", "VAULT_TLS_KEY"] as const;

const lerArquivo = (key: (typeof TLS_VARS)[number]) => {
   const path = process.env[key]!.trim();
   try {
      return readFileSync(path);
   } catch (error) {
      throw new Error(`[config] ${key}: can't read ${path} (${(error as Error).message})`);
   }
};

export class VaultClient {
   private readonly base: URL | null;
   private readonly token: string;
   private readonly agent: HttpsAgent | undefined;
   private readonly servername: string;

   constructor(env: NodeJS.ProcessEnv = process.env) {
      const url = env.VAULT_URL?.trim();
      this.base = url ? new URL(url) : null;
      this.token = env.VAULT_TOKEN?.trim() ?? "";
      this.servername = env.VAULT_TLS_SERVER_NAME?.trim() || "vault";
      if (!this.base) return;
      if (!this.token) throw new Error("[config] VAULT_TOKEN is required when VAULT_URL is set");
      const definidas = TLS_VARS.filter((k) => env[k]?.trim());
      if (definidas.length === 0) {
         if (apiEnv() === "production" || this.base.protocol === "https:") {
            throw new Error("[config] VAULT_TLS_CA, VAULT_TLS_CERT and VAULT_TLS_KEY are required: the vault only accepts mutual TLS");
         }
         return;
      }
      if (definidas.length !== TLS_VARS.length) {
         throw new Error("[config] set all of VAULT_TLS_CA, VAULT_TLS_CERT and VAULT_TLS_KEY, or none of them");
      }
      if (this.base.protocol !== "https:") throw new Error("[config] VAULT_URL must be https:// when VAULT_TLS_* are set");
      this.agent = new HttpsAgent({
         ca: lerArquivo("VAULT_TLS_CA"),
         cert: lerArquivo("VAULT_TLS_CERT"),
         key: lerArquivo("VAULT_TLS_KEY"),
         minVersion: "TLSv1.3",
         keepAlive: true,
         // the vault's certificate must name VAULT_TLS_SERVER_NAME, whatever address was dialled
         checkServerIdentity: (_host, cert) => {
            const nomes = (cert.subjectaltname ?? "").split(",").map((s) => s.trim().replace(/^DNS:/, ""));
            return nomes.includes(this.servername)
               ? undefined
               : new Error(`vault certificate does not name ${this.servername}`);
         },
      });
   }

   get configurado(): boolean {
      return this.base !== null;
   }

   private chamar(metodo: string, caminho: string, actor?: string, corpo?: unknown): Promise<Resposta> {
      if (!this.base) return Promise.reject(new VaultIndisponivel("VAULT_URL is not set"));
      const url = new URL(caminho, this.base);
      const payload = corpo === undefined ? undefined : Buffer.from(JSON.stringify(corpo));
      const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
      if (payload) {
         headers["Content-Type"] = "application/json";
         headers["Content-Length"] = String(payload.length);
      }
      if (actor) headers["X-Vault-Actor"] = actor;
      const req = url.protocol === "https:" ? httpsRequest : httpRequest;
      return new Promise((resolve, reject) => {
         const r = req(
            url,
            { method: metodo, headers, agent: this.agent, servername: this.servername, timeout: 5000 },
            (res) => {
               const partes: Buffer[] = [];
               res.on("data", (c: Buffer) => partes.push(c));
               res.on("end", () => {
                  const texto = Buffer.concat(partes).toString("utf8");
                  let body: unknown = null;
                  try {
                     body = texto ? JSON.parse(texto) : null;
                  } catch {
                     body = texto;
                  }
                  resolve({ status: res.statusCode ?? 0, body });
               });
            },
         );
         r.on("timeout", () => r.destroy(new Error("vault timed out")));
         r.on("error", (e) => reject(new VaultIndisponivel(`vault unreachable: ${e.message}`)));
         if (payload) r.write(payload);
         r.end();
      });
   }

   private falha(res: Resposta, acao: string): never {
      const msg = (res.body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      if (res.status === 409) throw new VaultConflito(msg);
      if (res.status === 400) throw new Error(`vault rejected ${acao}: ${msg}`);
      throw new VaultIndisponivel(`vault ${acao} failed: ${msg}`);
   }

   private caminho(ownerType: string, ownerId: string) {
      return `/v1/records/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}`;
   }

   // replaces the owner's whole record
   async put(ownerType: string, ownerId: string, data: VaultDados, actor?: string): Promise<VaultRecord> {
      const res = await this.chamar("PUT", this.caminho(ownerType, ownerId), actor, { data });
      if (res.status !== 200) this.falha(res, "put");
      return res.body as VaultRecord;
   }

   // null when the owner has no record
   async get(ownerType: string, ownerId: string, reveal: boolean, actor?: string): Promise<VaultRecord | null> {
      const res = await this.chamar("GET", this.caminho(ownerType, ownerId) + (reveal ? "?reveal=true" : ""), actor);
      if (res.status === 404) return null;
      if (res.status !== 200) this.falha(res, "get");
      return res.body as VaultRecord;
   }

   // masked records of the owners that have one, by owner id
   async getMasked(ownerType: string, ownerIds: string[], actor?: string): Promise<Map<string, VaultRecord>> {
      const out = new Map<string, VaultRecord>();
      for (let i = 0; i < ownerIds.length; i += 500) {
         const res = await this.chamar("POST", `/v1/records/${encodeURIComponent(ownerType)}/batch-get`, actor, {
            owner_ids: ownerIds.slice(i, i + 500),
         });
         if (res.status !== 200) this.falha(res, "batch-get");
         for (const r of (res.body as { records: VaultRecord[] }).records) out.set(r.owner_id, r);
      }
      return out;
   }

   async delete(ownerType: string, ownerId: string, actor?: string): Promise<void> {
      const res = await this.chamar("DELETE", this.caminho(ownerType, ownerId), actor);
      if (res.status !== 204) this.falha(res, "delete");
   }

   // the owner id holding this CPF, or null
   async lookupCpf(ownerType: string, cpf: string, actor?: string): Promise<string | null> {
      const res = await this.chamar("POST", "/v1/lookup/cpf", actor, { owner_type: ownerType, cpf });
      if (res.status === 404) return null;
      if (res.status !== 200) this.falha(res, "lookup");
      return (res.body as { owner_id: string }).owner_id;
   }
}

let instancia: VaultClient | undefined;
export const vault = (): VaultClient => (instancia ??= new VaultClient());
