import { apiClient, ListResponse } from "../../../lib/api-client";

export type Cliente = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  estagio: string | null;
  url: string | null;
  cargo: string | null;
  senioridade: string | null;
  papeis: string[];
};

export type ContatoRanqueado = Pick<Cliente, "id" | "nome" | "email" | "url" | "cargo" | "senioridade" | "papeis"> & {
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

export const getClientes = (page: number, amount: number, busca: string) =>
  apiClient.get<ListResponse<Cliente>>("/clientes", { params: { page, amount, busca } }).then((r) => r.data);

export const getEmpresas = (page: number, amount: number, busca: string, decisores: boolean) =>
  apiClient.get<EmpresasResponse>("/clientes/empresas", { params: { page, amount, busca, decisores } }).then((r) => r.data);
