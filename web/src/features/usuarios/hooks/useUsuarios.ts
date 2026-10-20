import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUsuarios,
  getUsuarioById,
  registerUsuario,
  forgotPassword,
  resetPassword,
  createUsuario,
  updateUsuario,
  archiveUsuario,
  deleteUsuario,
} from "../api/usuario.api";
import { useAuth } from "../../../context/AuthContext";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";

// keeps the current page on screen while the next one loads
export const useUsuarios = (page = 1, amount = LIST_PAGE_SIZE) =>
  useQuery({
    queryKey: ["usuarios", "list", page, amount],
    queryFn: () => getUsuarios(page, amount),
    placeholderData: keepPreviousData,
  });

export const useUsuario = (id: string) =>
  useQuery({ queryKey: ["usuarios", id], queryFn: () => getUsuarioById(id), enabled: !!id });

export const useRegisterUsuario = () =>
  useMutation({ mutationFn: registerUsuario });

export const useCreateUsuario = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};

export const useForgotPassword = () => useMutation({ mutationFn: forgotPassword });

export const useResetPassword = () => useMutation({ mutationFn: resetPassword });

export const useLogin = () => {
  const { login } = useAuth();
  return useMutation({ mutationFn: login });
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
