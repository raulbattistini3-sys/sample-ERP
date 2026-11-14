import { apiTls } from "../../configs/tls.config";
import "dotenv/config";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { hostname } from "node:os";

// The API's side of the network service (network/, Go). With NETWORK_URL (its private control address)
// and NETWORK_TOKEN set, the API registers itself as "api" under an instance id, keeps the registration
// alive with a heartbeat, and finds billing and the importer by service name instead of BILLING_URL /
// IMPORTER_GRPC_URL. Without them, those variables are used as before.
//
// Every call is signed exactly like network/registry/sign.go:
//   X-Network-Signature: t=<unix s>,n=<nonce>,s=hex(HMAC-SHA256(token, t\nn\nMETHOD\npath\nhex(sha256(body))))

export type Instancia = {
   service: string;
   id: string;
   address: string;
   version?: string;
   meta?: Record<string, string>;
   healthy: boolean;
};

export type Registro = {
   address: string;
   version?: string;
   health?: string;
   meta?: Record<string, string>;
   ttlSeconds?: number;
};

const HEADER = "X-Network-Signature";
const TIMEOUT_MS = 3_000;
// how long a resolved list is reused: instances come and go on a 5s heartbeat / 15s TTL
const CACHE_MS = 5_000;

export function assinar(token: string, method: string, path: string, body: string, agora = Date.now()): string {
   const t = String(Math.floor(agora / 1000));
   const n = randomBytes(12).toString("hex");
   const corpo = createHash("sha256").update(body).digest("hex");
   const s = createHmac("sha256", token).update(`${t}\n${n}\n${method.toUpperCase()}\n${path}\n${corpo}`).digest("hex");
   return `t=${t},n=${n},s=${s}`;
}

// api-<host>-<random>, the same shape as network/client.NewID
export function novoId(service: string): string {
   if (process.env.NETWORK_INSTANCE_ID?.trim()) return process.env.NETWORK_INSTANCE_ID.trim();
   const host = hostname().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 24);
   return `${service}-${host}-${randomBytes(4).toString("hex")}`;
}

export class NetworkClient {
   private readonly cache = new Map<string, { em: number; instancias: Instancia[]; proxima: number }>();
   private heartbeat: NodeJS.Timeout | null = null;
   private registrado: { service: string; id: string } | null = null;
   // null until the first beat answers, so the first success and the first failure are both logged
   private ok: boolean | null = null;

   constructor(
      private readonly base: string,
      private readonly token: string,
      private readonly log: (nivel: "info" | "warn", mensagem: string) => void = (n, m) => console[n](m),
   ) {}

   static doAmbiente(): NetworkClient | null {
      const base = process.env.NETWORK_URL?.trim().replace(/\/$/, "");
      const token = process.env.NETWORK_TOKEN;
      return base && token ? new NetworkClient(base, token) : null;
   }

   private async chamar<T>(method: string, path: string, body?: unknown): Promise<T> {
      const texto = body === undefined ? "" : JSON.stringify(body);
      const res = await fetch(this.base + path, {
         method,
         headers: { "Content-Type": "application/json", [HEADER]: assinar(this.token, method, path, texto) },
         body: body === undefined ? undefined : texto,
         signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
         const detalhe = (await res.json().catch(() => null)) as { message?: string } | null;
         throw new Error(`network ${method} ${path}: HTTP ${res.status} ${detalhe?.message ?? ""}`.trim());
      }
      return (res.status === 204 ? undefined : await res.json()) as T;
   }

   registrar(service: string, id: string, registro: Registro) {
      return this.chamar<Instancia>("PUT", `/registry/${service}/${encodeURIComponent(id)}`, registro);
   }

   // registers now and every `cadaMs` until sair(); a failed beat is logged once and retried
   manter(service: string, id: string, registro: Registro, cadaMs = 5_000) {
      this.registrado = { service, id };
      const reg = { ttlSeconds: Math.ceil((3 * cadaMs) / 1000), ...registro };
      const batida = async () => {
         try {
            await this.registrar(service, id, reg);
            if (this.ok !== true) this.log("info", `[network] registrado como ${service}/${id} em ${reg.address}`);
            this.ok = true;
         } catch (error) {
            if (this.ok !== false) this.log("warn", `[network] registro falhou; tentando de novo: ${(error as Error).message}`);
            this.ok = false;
         }
      };
      void batida();
      this.heartbeat = setInterval(batida, cadaMs);
      this.heartbeat.unref();
   }

   async sair() {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (!this.registrado) return;
      const { service, id } = this.registrado;
      this.registrado = null;
      await this.chamar("DELETE", `/registry/${service}/${encodeURIComponent(id)}`).catch(() => undefined);
   }

   async resolver(service: string): Promise<Instancia[]> {
      const agora = Date.now();
      const visto = this.cache.get(service);
      if (visto && agora - visto.em < CACHE_MS) return visto.instancias;
      try {
         const { instances } = await this.chamar<{ instances: Instancia[] }>("GET", `/registry/${service}`);
         this.cache.set(service, { em: agora, instancias: instances ?? [], proxima: visto?.proxima ?? 0 });
         return instances ?? [];
      } catch (error) {
         // the network being down for a moment shouldn't take billing down with it: keep the last list
         if (visto) return visto.instancias;
         throw error;
      }
   }

   // one healthy instance's address, round robin; null when none is registered (or the network is down)
   async endereco(service: string): Promise<string | null> {
      const instancias = await this.resolver(service).catch(() => []);
      if (!instancias.length) return null;
      const entrada = this.cache.get(service)!;
      const escolhida = instancias[entrada.proxima % instancias.length];
      entrada.proxima = (entrada.proxima + 1) % 1_000_000;
      return escolhida.address;
   }
}

// one per process: the API registers itself with it in index.ts, and the billing/importer clients ask it
export const rede = NetworkClient.doAmbiente();

// the address this API is reached at, from the port it actually bound (a development port move included)
export function anunciar(porta: number): string {
   const host = process.env.NETWORK_ADVERTISE_HOST?.trim() || "127.0.0.1";
   const scheme = apiTls() ? "https" : "http";
   return `${scheme}://${host.includes(":") ? `[${host}]` : host}:${porta}`;
}
