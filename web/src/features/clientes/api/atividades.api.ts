import { apiClient, ItemResponse } from "../../../lib/api-client";

// Shortcuts on Clientes: a note, an e-mail or a meeting straight to the HubSpot timeline, and the Funil
// board of the companies by lifecycle stage.

export type TipoAtividade = "nota" | "email" | "reuniao";

export type NovaAtividade = { contatoId?: string | null; empresaId?: string | null } & (
  | { tipo: "nota"; corpo: string }
  | { tipo: "email"; assunto: string; corpo: string; enviar: boolean }
  | { tipo: "reuniao"; titulo: string; inicio: string; duracaoMinutos: number; local: string; descricao: string }
);

export type AtividadeCriada = { id: string; tipo: TipoAtividade; emailEnviado: boolean | null; aviso: string | null };

export const registrarAtividade = (atividade: NovaAtividade) =>
  apiClient.post<ItemResponse<AtividadeCriada>>("/clientes/atividades", atividade).then((r) => r.data.data);

export type Responsavel = { id: string; nome: string; email: string | null };
export const getResponsaveis = () => apiClient.get<ItemResponse<Responsavel[]>>("/clientes/empresas/responsaveis").then((r) => r.data.data);

// HubSpot's lifecyclestage, in board order; "nao_contatado" is no stage (or subscriber/other)
export const ESTAGIOS = ["nao_contatado", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"] as const;
export type Estagio = (typeof ESTAGIOS)[number];
export const ESTAGIO_LABEL: Record<Estagio, string> = {
  nao_contatado: "Não contatado",
  lead: "Lead",
  marketingqualifiedlead: "Lead qualificado (marketing)",
  salesqualifiedlead: "Lead qualificado (vendas)",
  opportunity: "Oportunidade",
  customer: "Cliente",
};

export type EmpresaNoFunil = {
  id: string;
  nome: string;
  dominio: string | null;
  cidade: string | null;
  estado: string | null;
  setor: string | null;
  responsavelId: string | null;
  estagio: Estagio;
};
export type ColunaDoFunil = { data: EmpresaNoFunil[]; total: number; proxima: string | null };

export const getFunil = (estagio: Estagio, after: string | null, busca: string, limite: number) =>
  apiClient
    .get<ColunaDoFunil>("/clientes/funil", { params: { estagio, after: after ?? undefined, busca: busca || undefined, limite } })
    .then((r) => r.data);

export const moverEmpresa = (id: string, estagio: Estagio) => apiClient.put(`/clientes/empresas/${id}/estagio`, { estagio }).then(() => null);
