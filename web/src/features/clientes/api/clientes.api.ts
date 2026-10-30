import { apiClient, ListResponse } from "../../../lib/api-client";

export type Cliente = {
  id: string;
  hubspot_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  estagio: string | null;
  url: string | null;
};

export type ClientesResponse = ListResponse<Cliente> & { sincronizado_em: string | null };

export const getClientes = (page: number, amount: number, busca: string) =>
  apiClient.get<ClientesResponse>("/clientes", { params: { page, amount, busca } }).then((r) => r.data);

// reads every contact from HubSpot, so it can take a while on a big account
export const sincronizarClientes = () =>
  apiClient.post<{ sincronizados: number; removidos: number }>("/clientes/sincronizar", null, { timeout: 0 }).then((r) => r.data);
