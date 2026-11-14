import { apiClient, ItemResponse } from "../../../lib/api-client";

export type Unidade = "dias" | "meses";
export type StatusPlano = "ativo" | "pausado" | "encerrado" | "cancelado";

export type Ciclo = {
  ciclo: number;
  dataReferencia: string; // YYYY-MM-DD
  valorCentavos: number;
  status: "emitida" | "falhou" | "pulado";
  faturaId: string | null;
  faturaNumero: string | null;
  faturaUrl: string | null;
  vencimento: string | null;
  emailEnviado: boolean;
  erro: string | null;
  criadoEm: string;
};

export type PagamentoMensal = {
  id: string;
  hubspotContatoId: string;
  descricao: string;
  valorCentavos: number;
  valorMaximoCentavos: number;
  valorMinimoCentavos: number | null;
  intervalo: number;
  unidade: Unidade;
  vencimentoDias: number;
  dataInicio: string;
  dataFim: string | null;
  cc: string[];
  cco: string[];
  proximoCiclo: number;
  proximaData: string;
  status: StatusPlano;
  tentativas: number;
  ultimoErro: string | null;
  criadoPorNome: string;
  criadoEm: string;
  cliente: { id: string; nome: string; email: string | null; url: string | null } | null;
  ciclos: Ciclo[];
};

// values in reais
export type NovoPagamentoMensal = {
  clienteId: string;
  descricao: string;
  valor: number;
  valorMaximo: number;
  valorMinimo: number | null;
  intervalo: number;
  unidade: Unidade;
  vencimentoDias: number;
  dataInicio: string;
  dataFim: string | null;
  cc: string[];
  cco: string[];
};

export type AlteracaoPagamentoMensal = Pick<NovoPagamentoMensal, "descricao" | "valor" | "valorMaximo" | "valorMinimo" | "vencimentoDias" | "dataFim" | "cc" | "cco">;

const BASE = "/cobrancas/recorrentes";

export const getPagamentosMensais = (clienteId?: string) =>
  apiClient.get<ItemResponse<PagamentoMensal[]>>(BASE, { params: clienteId ? { clienteId } : undefined }).then((r) => r.data.data);

export const createPagamentoMensal = (novo: NovoPagamentoMensal) =>
  apiClient.post<ItemResponse<PagamentoMensal>>(BASE, novo).then((r) => r.data.data);

export const updatePagamentoMensal = (id: string, alteracao: AlteracaoPagamentoMensal) =>
  apiClient.put<ItemResponse<PagamentoMensal>>(`${BASE}/${id}`, alteracao).then((r) => r.data.data);

export const acaoPagamentoMensal = (id: string, acao: "pausar" | "retomar" | "cancelar") =>
  apiClient.post<ItemResponse<PagamentoMensal>>(`${BASE}/${id}/${acao}`).then((r) => r.data.data);
