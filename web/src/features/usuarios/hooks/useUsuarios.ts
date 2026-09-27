import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUsuarios, getUsuarioById, registerUsuario, loginUsuario, updateUsuario, archiveUsuario, deleteUsuario } from "../api/usuario.api";
import { useAuth } from "../../../context/AuthContext";

export const useUsuarios = () =>
  useQuery({ queryKey: ["usuarios"], queryFn: getUsuarios });

export const useUsuario = (id: string) =>
  useQuery({ queryKey: ["usuarios", id], queryFn: () => getUsuarioById(id), enabled: !!id });

export const useRegisterUsuario = () =>
  useMutation({ mutationFn: registerUsuario });

export const useLogin = () => {
  const { login } = useAuth();
  return useMutation({
    mutationFn: ({ email, senha }: { email: string; senha: string }) => login(email, senha),
  });
};

export const useUpdateUsuario = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};

export const useArchiveUsuario = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};

export const useDeleteUsuario = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};
