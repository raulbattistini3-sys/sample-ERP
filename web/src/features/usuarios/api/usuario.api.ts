import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import {
  RegisterUsuarioPayload,
  LoginUsuarioPayload,
  LoginResponseSchema,
  UpdateUsuarioPayload,
  Usuario,
  UsuarioSchema,
} from "../types/usuario.types";

export const registerUsuario = (payload: RegisterUsuarioPayload) => apiClient.post("/user/register", payload);
export const loginUsuario = async (payload: LoginUsuarioPayload) => {
  const { data } = await apiClient.post("/user/login", payload);
  return LoginResponseSchema.parse(data);
};
export const getUsuarios = (page: number, amount: number) =>
  apiClient.get<ListResponse<Usuario>>("/user", { params: { page, amount } }).then((r) => r.data);
// parsed so only the known fields are kept (the result may be stored in localStorage)
export const getUsuarioById = (id: string) =>
  apiClient.get<ItemResponse<Usuario>>(`/user/${id}`).then((r) => UsuarioSchema.parse(r.data.data));
export const updateUsuario = (payload: UpdateUsuarioPayload) => apiClient.put(`/user/${payload.id}`, payload);
export const archiveUsuario = (id: string) => apiClient.patch(`/user/${id}/archive`);
export const deleteUsuario = (id: string) => apiClient.delete(`/user/${id}`);
