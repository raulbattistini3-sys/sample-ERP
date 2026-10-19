import { apiClient } from "../../../lib/api-client";
import {
  RegisterUsuarioPayload,
  LoginUsuarioPayload,
  LoginResponseSchema,
  UpdateUsuarioPayload,
  Usuario,
} from "../types/usuario.types";

export const registerUsuario = (payload: RegisterUsuarioPayload) => apiClient.post("/user/register", payload);
export const loginUsuario = async (payload: LoginUsuarioPayload) => {
  const { data } = await apiClient.post("/user/login", payload);
  return LoginResponseSchema.parse(data);
};
export const getUsuarios = () => apiClient.get<Usuario[]>("/user");
export const getUsuarioById = (id: string) => apiClient.get<Usuario>(`/user/${id}`);
export const updateUsuario = (payload: UpdateUsuarioPayload) => apiClient.put(`/user/${payload.id}`, payload);
export const archiveUsuario = (id: string) => apiClient.patch(`/user/${id}/archive`);
export const deleteUsuario = (id: string) => apiClient.delete(`/user/${id}`);
