import { apiClient } from "../../../lib/api-client";

// Stripe through the billing service: the Integrações card and the Cobranças page

export type StripeConexao = {
  configurado: boolean; // BILLING_URL set on the API
  alcancavel: boolean; // the billing service answered
  status: {
    conectado: boolean; // Stripe accepted billing's key
    conta: { id: string; nome: string | null; pais: string | null; moeda: string | null; cobrancasAtivas: boolean } | null;
    modoTeste: boolean;
    webhookConfigurado: boolean;
    erro: string | null;
  } | null;
  eventos: { id: string; tipo: string; criadoEm: string; producao: boolean; resumo: string | null }[];
  erro: string | null;
};

export type NovaCobranca = { clienteIds: string[]; descricao: string; valor: number; vencimentoDias: number; cc: string[]; cco: string[] };

export type ResultadoCobranca = {
  clienteId: string;
  nome: string;
  email: string | null;
  ok: boolean;
  numero: string | null;
  url: string | null;
  vencimento: string | null;
  erro: string | null;
  emailEnviado: boolean;
  semCopias?: boolean; // the e-mail went to the client but the provider refused the CC/CCO (e.g. Resend test mode)
  notaNoHubspot?: boolean; // the note on the client's HubSpot timeline
  whatsapp?: WhatsappStatus | null;
};

export type WhatsappStatus = "enviado" | "ja_enviado" | "sem_telefone" | "desligado" | "falhou";

// the backfill of HubSpot timeline notes for invoices billed before the notes existed
export type LinhaDoTempo = {
  rodando: boolean;
  iniciadaEm: string | null;
  terminadaEm: string | null;
  faturas: number;
  notas: number;
  pagas: number;
  semCliente: number;
  erros: string[];
  whatsappConfigurado: boolean;
};

export type CobrancaEmitida = { resultados: ResultadoCobranca[]; emissorNotificado: boolean; erroEmailEmissor: string | null };

export type FaturaRecente = {
  id: string;
  numero: string | null;
  status: string; // draft | open | paid | void | uncollectible
  clienteNome: string | null;
  clienteEmail: string | null;
  valorCentavos: number;
  pagoCentavos: number;
  criadaEm: string;
  vencimento: string | null;
  url: string | null;
  emissor: string | null;
  descricao?: string | null;
  // when Stripe recorded the payment (or the webhook reported it, for one paid a moment ago)
  pagaEm?: string | null;
};

export type PaginaDeFaturas = { faturas: FaturaRecente[]; proxima: string | null };

// what GET /cobrancas/eventos sends when the billing webhook reports a payment
export type FaturaPagaEvento = {
  faturaId: string;
  numero: string | null;
  valorCentavos: number;
  email: string;
  nome: string | null;
  url: string | null;
  pagaEm: string;
};

export const getStripeConexao = () => apiClient.get<StripeConexao>("/integracoes/stripe").then((r) => r.data);

export const emitirCobranca = (payload: NovaCobranca) =>
  apiClient.post<{ data: CobrancaEmitida }>("/cobrancas", payload).then((r) => r.data.data);

export const getLinhaDoTempo = () => apiClient.get<{ data: LinhaDoTempo }>("/cobrancas/linha-do-tempo").then((r) => r.data.data);

export const sincronizarLinhaDoTempo = () =>
  apiClient.post<{ data: LinhaDoTempo }>("/cobrancas/linha-do-tempo/sincronizar").then((r) => r.data.data);

export const getCobrancasPagas = (pagina: string | null, limite = 50) =>
  apiClient
    .get<{ data: PaginaDeFaturas }>("/cobrancas/pagas", { params: { limite, ...(pagina ? { pagina } : {}) } })
    .then((r) => r.data.data);

export const getCobrancasRecentes = () => apiClient.get<{ data: FaturaRecente[] }>("/cobrancas").then((r) => r.data.data);
