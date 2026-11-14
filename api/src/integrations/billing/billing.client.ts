import { BaseAppError } from "../../errors/global_error.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";
import { NetworkClient, rede } from "../network/network.client";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { apiTls } from "../../configs/tls.config";

// The API's way into the billing service (billing/, Spring Boot): Stripe status and events, and
// cobranças. BILLING_URL is where billing listens (https://billing:8081 in compose; the launcher sets it).
// Mutual TLS, TLS 1.3: the API shows its certificate (API_TLS_CERT/KEY, CN api) and checks that billing's
// is signed by API_TLS_CA and names "billing" (BILLING_TLS_SERVER_NAME), whatever address was dialled.

export type StripeStatus = {
  conectado: boolean;
  conta: { id: string; nome: string | null; pais: string | null; moeda: string | null; cobrancasAtivas: boolean } | null;
  modoTeste: boolean;
  webhookConfigurado: boolean;
  erro: string | null;
};

export type StripeEvento = { id: string; tipo: string; criadoEm: string; producao: boolean; resumo: string | null };

export type PedidoCobranca = {
  chave: string;
  descricao: string;
  valorCentavos: number;
  vencimentoDias: number;
  emissor: { nome: string; email: string };
  clientes: { id: string; nome: string; email: string }[];
};

export type ResultadoCobranca = {
  clienteId: string;
  ok: boolean;
  faturaId: string | null;
  numero: string | null;
  url: string | null;
  valorCentavos: number | null;
  vencimento: string | null;
  erro: string | null;
};

export type FaturaRecente = {
  id: string;
  numero: string | null;
  status: string;
  clienteNome: string | null;
  clienteEmail: string | null;
  valorCentavos: number;
  pagoCentavos: number;
  criadaEm: string;
  vencimento: string | null;
  url: string | null;
  emissor: string | null;
  // the HubSpot contact the invoice was issued to (metadata hubspot_id), its description and when it was paid
  hubspotId?: string | null;
  descricao?: string | null;
  pagaEm?: string | null;
};

export type PaginaDeFaturas = { faturas: FaturaRecente[]; proxima: string | null };

const TIMEOUT_MS = 15_000;
// creating invoices is one round trip per Stripe call, three or four per client
const COBRANCA_TIMEOUT_MS = 120_000;

export class BillingIndisponivel extends ServerError {}

class BillingClient {
  constructor(
    private readonly baseUrl = process.env.BILLING_URL?.replace(/\/$/, ""),
    private readonly network: NetworkClient | null = rede,
    private readonly servername = process.env.BILLING_TLS_SERVER_NAME?.trim() || "billing",
  ) {}

  private agente: HttpsAgent | null | undefined;

  private agent(): HttpsAgent | null {
    if (this.agente !== undefined) return this.agente;
    const tls = apiTls();
    this.agente = tls
      ? new HttpsAgent({
          ca: tls.ca,
          cert: tls.cert,
          key: tls.key,
          minVersion: "TLSv1.3",
          keepAlive: true,
          checkServerIdentity: (_host, cert) => {
            const nomes = (cert.subjectaltname ?? "").split(",").map((s) => s.trim().replace(/^DNS:/, ""));
            return nomes.includes(this.servername) ? undefined : new Error(`billing certificate does not name ${this.servername}`);
          },
        })
      : null;
    return this.agente;
  }

  // with the network service, billing is found by name (whatever port it ended up on); BILLING_URL is
  // then only the fallback for when no billing instance is registered
  get configurado() {
    return !!this.agent() && (!!this.baseUrl || !!this.network);
  }

  private async endereco(): Promise<string | null> {
    const registrado = await this.network?.endereco("billing");
    return registrado?.replace(/\/$/, "") ?? this.baseUrl ?? null;
  }

  status() {
    return this.request<StripeStatus>("GET", "/internal/stripe/status");
  }

  eventos(limite = 20) {
    return this.request<StripeEvento[]>("GET", `/internal/stripe/eventos?limite=${limite}`);
  }

  criarCobrancas(pedido: PedidoCobranca) {
    return this.request<ResultadoCobranca[]>("POST", "/internal/cobrancas", pedido, COBRANCA_TIMEOUT_MS);
  }

  recentes() {
    return this.request<FaturaRecente[]>("GET", "/internal/cobrancas");
  }

  // the paid invoices the ERP issued, newest first (Stripe search, {limite} per page): the Cobranças "Pagas" tab
  pagas(pagina: string | null, limite: number) {
    const qs = new URLSearchParams({ limite: String(limite), ...(pagina ? { pagina } : {}) });
    return this.request<PaginaDeFaturas>("GET", `/internal/cobrancas/pagas?${qs}`);
  }

  // every invoice the ERP issued, newest first, 100 per page (Stripe search): for the timeline backfill
  todas(pagina?: string | null) {
    return this.request<PaginaDeFaturas>("GET", `/internal/cobrancas/todas${pagina ? `?pagina=${encodeURIComponent(pagina)}` : ""}`, undefined, 60_000);
  }

  private async request<T>(method: string, path: string, body?: unknown, timeout = TIMEOUT_MS): Promise<Either<BaseAppError, T>> {
    if (!this.configurado) {
      return left(new BillingIndisponivel("503", true, "O serviço de cobranças não está configurado (BILLING_URL e API_TLS_* para o mTLS)."));
    }
    const base = await this.endereco();
    if (!base) {
      return left(new BillingIndisponivel("503", true, "O serviço de cobranças está fora do ar (nenhuma instância registrada na rede)."));
    }
    const url = new URL(`${base}${path}`);
    if (url.protocol !== "https:") {
      return left(new BillingIndisponivel("503", true, `O serviço de cobranças está em ${url.origin}, sem TLS; ele só é chamado por mTLS.`));
    }
    try {
      const res = await this.enviar(url, method, body === undefined ? undefined : JSON.stringify(body), timeout);
      if (res.status < 200 || res.status >= 300) {
        return left(new ServerError("503", true, `O serviço de cobranças recusou o pedido (HTTP ${res.status}).`, res.text));
      }
      return right(JSON.parse(res.text) as T);
    } catch (error) {
      return left(new BillingIndisponivel("503", true, "O serviço de cobranças está fora do ar.", error));
    }
  }

  // node:https rather than fetch: the client certificate works the same under Node and Bun (the launcher's api.exe)
  private enviar(url: URL, method: string, body: string | undefined, timeout: number) {
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method,
          agent: this.agent()!,
          timeout,
          headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error(`billing did not answer in ${timeout} ms`)));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

export default BillingClient;
