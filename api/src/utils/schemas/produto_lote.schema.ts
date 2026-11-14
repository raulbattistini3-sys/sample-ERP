import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACOES = ["inativar", "ativar", "favoritar", "desfavoritar", "salvar_depois", "tirar_depois"] as const;
export type AcaoEmLote = (typeof ACOES)[number];

// actions on several selected products at once, like an inbox's: select, then act on all of them
export const AcaoEmLoteSchema = z.object({
  acao: z.enum(ACOES, { errorMap: () => ({ message: "Ação inválida." }) }),
  ids: z
    .array(z.string().regex(UUID, "Produto inválido."), { invalid_type_error: "Selecione os produtos." })
    .min(1, "Selecione ao menos um produto.")
    .max(1000, "No máximo 1000 produtos por vez.")
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});
