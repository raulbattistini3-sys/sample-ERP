import { BaseAppError } from "../../errors/global_error.error";
import { ServerError } from "../../errors/server_errors/five_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";

// The API's way into the billing service (billing/, Spring Boot): Stripe status and events, and
// cobranças. BILLING_URL is where billing listens (the launcher and docker-compose.yml set it); it takes
// the same BILLING_INTERNAL_TOKEN billing already sends the API.

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
};

const TIMEOUT_MS = 15_000;
// creating invoices is one round trip per Stripe call, three or four per client
const COBRANCA_TIMEOUT_MS = 120_000;

export class BillingIndisponivel extends ServerError {}

class BillingClient {
  constructor(
    private readonly baseUrl = process.env.BILLING_URL?.replace(/\/$/, ""),
    private readonly token = process.env.BILLING_INTERNAL_TOKEN,
  ) {}

  get configurado() {
    return !!this.baseUrl && !!this.token;
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

  private async request<T>(method: string, path: string, body?: unknown, timeout = TIMEOUT_MS): Promise<Either<BaseAppError, T>> {
    if (!this.configurado) {
      return left(new BillingIndisponivel("503", true, "O serviço de cobranças não está configurado (BILLING_URL e BILLING_INTERNAL_TOKEN)."));
    }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return left(new ServerError("503", true, `O serviço de cobranças respondeu ${res.status}`, detail));
      }
      return right((await res.json()) as T);
    } catch (error) {
      return left(new BillingIndisponivel("503", true, "O serviço de cobranças não respondeu. Ele está rodando?", error));
    }
  }
}

export default BillingClient;
