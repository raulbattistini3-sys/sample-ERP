import { apiClient, ItemResponse, ListResponse } from "../../../lib/api-client";
import {
  RegisterUsuarioPayload,
  LoginUsuarioPayload,
  LoginResponseSchema,
  UpdateUsuarioPayload,
  Usuario,
  UsuarioSchema,
} from "../types/usuario.types";

// public sign-up: the API always creates an active Estoque usuario
export const registerUsuario = (payload: RegisterUsuarioPayload) => apiClient.post("/user/register", payload);
// ADM only: honors permissoes and ativo
export const createUsuario = (payload: RegisterUsuarioPayload) => apiClient.post("/user", payload);
export const loginUsuario = async (payload: LoginUsuarioPayload) => {
  const { data } = await apiClient.post("/user/login", payload);
  return LoginResponseSchema.parse(data);
};
// always answers with the same message, whether or not the email has an account
export const forgotPassword = (email: string) =>
  apiClient.post<{ message: string }>("/user/forgot-password", { email }).then((r) => r.data.message);
// 400 when the link's token is unknown, used or expired
export const resetPassword = (payload: { token: string; senha: string }) =>
  apiClient.post("/user/reset-password", payload);

// trades the current (still valid) token for a new one; 401 if it already expired
export const refreshSession = async () => {
  const { data } = await apiClient.post("/user/refresh-token");
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
