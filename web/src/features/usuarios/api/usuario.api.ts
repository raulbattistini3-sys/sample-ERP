import { apiClient } from "../../../lib/api-client";
import { RegisterUsuarioPayload, LoginUsuarioPayload, UpdateUsuarioPayload, Usuario } from "../types/usuario.types";

export const registerUsuario = (payload: RegisterUsuarioPayload) => apiClient.post("/user/register", payload);
export const loginUsuario = (payload: LoginUsuarioPayload) => apiClient.post("/user/login", payload);
export const getUsuarios = () => apiClient.get<Usuario[]>("/user");
export const getUsuarioById = (id: string) => apiClient.get<Usuario>(`/user/${id}`);
export const updateUsuario = (payload: UpdateUsuarioPayload) => apiClient.put(`/user/${payload.id}`, payload);
export const archiveUsuario = (id: string) => apiClient.patch(`/user/${id}/archive`);
export const deleteUsuario = (id: string) => apiClient.delete(`/user/${id}`);
