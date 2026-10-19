import { useMemo } from "react";
import { useUsuarios } from "../../usuarios/hooks/useUsuarios";

// GET /user is admin-only, so for other roles this stays empty and callers fall back to the raw id
export const useAuditorNames = () => {
  const { data: usuarios } = useUsuarios();
  return useMemo(() => new Map(usuarios?.map((u) => [u.id, u.nome])), [usuarios]);
};
