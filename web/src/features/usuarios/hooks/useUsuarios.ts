import { ListFilterParams } from "../../../hooks/useListFilters";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUsuarios,
  getUsuarioById,
  registerUsuario,
  forgotPassword,
  resetPassword,
  changePassword,
  createUsuario,
  updateUsuario,
  archiveUsuario,
  deleteUsuario,
} from "../api/usuario.api";
import { useAuth } from "../../../context/AuthContext";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";

// keeps the current page on screen while the next one loads
export const useUsuarios = (page = 1, amount = LIST_PAGE_SIZE, filters: ListFilterParams = {}) =>
  useQuery({
    queryKey: ["usuarios", "list", page, amount, filters],
    queryFn: () => getUsuarios(page, amount, filters),
    placeholderData: keepPreviousData,
  });

export const useUsuario = (id: string) =>
  useQuery({ queryKey: ["usuarios", id], queryFn: () => getUsuarioById(id), enabled: !!id });

export const useRegisterUsuario = () =>
  useSingleFlightMutation({ mutationFn: registerUsuario });

export const useCreateUsuario = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: createUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};

export const useForgotPassword = () => useSingleFlightMutation({ mutationFn: forgotPassword });

export const useResetPassword = () => useSingleFlightMutation({ mutationFn: resetPassword });

// on success the new session replaces the old one, whose token the API no longer accepts
export const useChangePassword = () => {
  const { applySession } = useAuth();
  return useSingleFlightMutation({ mutationFn: changePassword, onSuccess: applySession });
};

export const useLogin = () => {
  const { login } = useAuth();
  return useSingleFlightMutation({ mutationFn: login });
};

export const useUpdateUsuario = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: updateUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};

export const useArchiveUsuario = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: archiveUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};

export const useDeleteUsuario = () => {
  const queryClient = useQueryClient();
  return useSingleFlightMutation({
    mutationFn: deleteUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usuarios"] }),
  });
};
