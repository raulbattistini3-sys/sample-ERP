import { useMemo } from "react";
import { useUsuarios } from "../../usuarios/hooks/useUsuarios";

// enough to cover every user in one request, since GET /user is paginated
const ALL_USUARIOS_AMOUNT = 1000;

// GET /user is admin-only, so for other roles this stays empty and callers fall back to the raw id
export const useAuditorNames = () => {
  const { data } = useUsuarios(1, ALL_USUARIOS_AMOUNT);
  const usuarios = data?.data;
  return useMemo(() => new Map(usuarios?.map((u) => [u.id, u.nome])), [usuarios]);
};
