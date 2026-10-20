import { useMemo } from "react";
import { useUsuarios } from "../../usuarios/hooks/useUsuarios";
import { ALL_ITEMS_AMOUNT } from "../../../lib/pagination";

// GET /user is admin-only, so for other roles this stays empty and callers fall back to the raw id
export const useAuditorNames = () => {
  const { data } = useUsuarios(1, ALL_ITEMS_AMOUNT);
  const usuarios = data?.data;
  return useMemo(() => new Map(usuarios?.map((u) => [u.id, u.nome])), [usuarios]);
};
