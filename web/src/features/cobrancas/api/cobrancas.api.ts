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

export type NovaCobranca = { clienteIds: string[]; descricao: string; valor: number; vencimentoDias: number };

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
};

export const getStripeConexao = () => apiClient.get<StripeConexao>("/integracoes/stripe").then((r) => r.data);

export const emitirCobranca = (payload: NovaCobranca) =>
  apiClient.post<{ data: CobrancaEmitida }>("/cobrancas", payload).then((r) => r.data.data);

export const getCobrancasRecentes = () => apiClient.get<{ data: FaturaRecente[] }>("/cobrancas").then((r) => r.data.data);
