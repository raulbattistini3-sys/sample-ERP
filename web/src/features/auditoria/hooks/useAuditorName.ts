import { useCallback } from "react";
import { useAuth } from "../../../context/AuthContext";

// nome_do_auditor holds the usuario id; only the logged-in user's name is known client-side
export const useAuditorName = () => {
  const { user } = useAuth();
  return useCallback(
    (usuarioId: string) => (user && usuarioId === user.id ? user.nome : usuarioId.slice(0, 8)),
    [user],
  );
};
