import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import { carregarPagina, type Medicao } from "../carga/cargaAdaptativa";
import type { Estagio } from "./atividades.api";

export type Cliente = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  // the HubSpot company the client is linked to; null: "sem empresa"
  empresaId: string | null;
  estagio: string | null;
  url: string | null;
  cargo: string | null;
  senioridade: string | null;
  // "erp": set here (kept in the ERP's database); "hubspot": HubSpot's own; null: none
  senioridadeOrigem: "erp" | "hubspot" | null;
  papeis: string[];
  primeiroNome: string | null;
  sobrenome: string | null;
};

export type ContatoRanqueado = Pick<Cliente, "id" | "nome" | "email" | "url" | "cargo" | "senioridade" | "senioridadeOrigem" | "papeis"> & {
  posicao: number; // rank within the company, from 1
};

export type Empresa = {
  id: string;
  nome: string;
  dominio: string | null;
  setor: string | null;
  url: string | null;
  total_contatos: number;
  total_decisores: number;
  contatos: ContatoRanqueado[];
};

export type EmpresasResponse = ListResponse<Empresa> & { sem_empresa: number };

// one form for creating and editing; written to HubSpot, except senioridade, which the ERP keeps
// (null clears the ERP's, so HubSpot's shows again)
export type ClienteForm = {
  primeiroNome: string;
  sobrenome: string;
  email: string;
  telefone: string;
  // the company picked (empresaId) or, with none picked, a name: found in HubSpot or created there
  empresa: string;
  empresaId: string | null;
  cargo: string;
  senioridade: string | null;
  // HubSpot's buying role "Decision maker"
  decisor: boolean;
};

// A clients spreadsheet goes to the Go importer as a file (up to 500,000 rows). POST answers 202; the
// import is then polled. Its failed rows are paged by seq, so the page only asks for the ones after the
// last it already has.
export type StatusImportacaoClientes = "pendente" | "processando" | "concluida" | "rejeitada" | "falhou";
export type ImportacaoClientes = {
  id: string;
  status: StatusImportacaoClientes;
  nome_arquivo: string;
  // 0 until the importer has counted the rows
  total_linhas: number;
  linhas_processadas: number;
  linhas_criadas: number;
  linhas_atualizadas: number;
  linhas_falharam: number;
  empresas_criadas: number;
  // rejeitada (e.g. no E-mail column, over 500,000 rows) or falhou (HubSpot not connected...)
  mensagem: string;
  criada_em: string | null;
  finalizada_em: string | null;
};
export type ErroImportacaoClientes = { seq: number; linha: number; campo: string; email: string; mensagem: string };
export type PaginaDeErros = { data: ErroImportacaoClientes[]; proximo: number | null };

export const importacaoClientesTerminou = (status: StatusImportacaoClientes) =>
  status === "concluida" || status === "rejeitada" || status === "falhou";

// Criar empresa: written to HubSpot, except the SAC e-mail, which the ERP keeps
export type EmpresaDetalhe = {
  id: string;
  nome: string;
  dominio: string | null;
  setor: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  pais: string | null;
  site: string | null;
  descricao: string | null;
  emailSac: string | null;
  // HubSpot user who owns the company, and its Funil stage (changed with moverEmpresa)
  responsavelId: string | null;
  estagio: Estagio;
  url: string | null;
};
export type EmpresaForm = Record<Exclude<keyof EmpresaDetalhe, "id" | "url" | "estagio">, string>;
export type EmpresaSalva = ItemResponse<EmpresaDetalhe> & { aviso: string | null };
export type Setor = { value: string; label: string };

export type ClienteSalvo = ItemResponse<Cliente> & { aviso: string | null };

// ms: how long the page took (network, API + HubSpot, parse) for the dev timing line; alvo: the thread that
// parsed it (carga/cargaAdaptativa, which also reports each load to telemetry)
export type ComTempo<T> = T & Medicao;

export const getClientes = (page: number, amount: number, busca: string) =>
  carregarPagina<ListResponse<Cliente>>("/clientes", { params: { page, amount, busca } }, { endpoint: "clientes", page, busca });

export const getEmpresas = (page: number, amount: number, busca: string, decisores: boolean) =>
  carregarPagina<EmpresasResponse>(
    "/clientes/empresas",
    { params: { page, amount, busca, decisores } },
    { endpoint: "clientes/empresas", page, busca, extra: { decisores, amount } },
  );

export const getCliente = (id: string) => apiClient.get<ItemResponse<Cliente>>(`/clientes/${id}`).then((r) => r.data.data);

export const createCliente = (form: ClienteForm) => apiClient.post<ClienteSalvo>("/clientes", form).then((r) => r.data);

export const updateCliente = (id: string, form: ClienteForm) => apiClient.put<ClienteSalvo>(`/clientes/${id}`, form).then((r) => r.data);

// Clientes and Empresas spreadsheets go through the same importer and answer in the same shape;
// for empresas, a failed row's `email` holds the company name
export type TipoImportacao = "clientes" | "empresas";
const IMPORTACOES: Record<TipoImportacao, string> = {
  clientes: "/clientes/importacoes",
  empresas: "/clientes/empresas/importacoes",
};

export const iniciarImportacaoClientes = (arquivo: File, tipo: TipoImportacao = "clientes") => {
  const form = new FormData();
  form.append("planilha", arquivo);
  // multipart, not the client's default JSON (see startProductImport)
  return apiClient
    .post<ItemResponse<ImportacaoClientes>>(IMPORTACOES[tipo], form, {
      headers: { "Content-Type": "multipart/form-data" },
      // a 100 MB upload on a slow connection
      timeout: 10 * 60 * 1000,
    })
    .then((r) => r.data.data);
};

export const getImportacaoClientes = (id: string, tipo: TipoImportacao = "clientes") =>
  apiClient.get<ItemResponse<ImportacaoClientes>>(`${IMPORTACOES[tipo]}/${id}`).then((r) => r.data.data);

export const getErrosImportacaoClientes = (id: string, depois: number, limite = 500, tipo: TipoImportacao = "clientes") =>
  apiClient.get<PaginaDeErros>(`${IMPORTACOES[tipo]}/${id}/erros`, { params: { depois, limite } }).then((r) => r.data);

export const getEmpresa = (id: string) => apiClient.get<ItemResponse<EmpresaDetalhe>>(`/clientes/empresas/${id}`).then((r) => r.data.data);

export const getClientesDaEmpresa = (id: string) =>
  apiClient.get<ItemResponse<Cliente[]>>(`/clientes/empresas/${id}/clientes`).then((r) => r.data.data);

export type VinculoEmpresa = { vinculados: string[]; falhas: { clienteId: string; mensagem: string }[] };

// clientes registered before the company: each one is moved under it
export const vincularClientesAEmpresa = (id: string, clienteIds: string[]) =>
  apiClient.post<ItemResponse<VinculoEmpresa>>(`/clientes/empresas/${id}/clientes`, { clienteIds }).then((r) => r.data.data);

export const getSetores =() => apiClient.get<ItemResponse<Setor[]>>("/clientes/empresas/setores").then((r) => r.data.data);

// empty fields go as null: cleared in HubSpot
const semVazios = (form: EmpresaForm) => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));

export const createEmpresa = (form: EmpresaForm) => apiClient.post<EmpresaSalva>("/clientes/empresas", semVazios(form)).then((r) => r.data);

export const updateEmpresa = (id: string, form: EmpresaForm) =>
  apiClient.put<EmpresaSalva>(`/clientes/empresas/${id}`, semVazios(form)).then((r) => r.data);
