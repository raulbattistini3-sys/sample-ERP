import { z } from "zod/mini";

export const CategoriaNomesEnum = z.enum([
  "ELETRONICOS",
  "INFORMATICA",
  "ELETRODOMESTICOS",
  "CELULARES",
  "MERCADO",
  "CASA",
  "COMERCIO & SEGURANCA",
  "LAZER E ENTRETENIMENTO",
  "MODA",
  "ESPORTE E SAUDE",
]);

export const CategoriaTiposEnum = z.enum(["Normal", "Especial", "Personalizado"]);

export const CategoriaSchema = z.object({
  id: z.string(),
  nome: CategoriaNomesEnum,
  ativo: z.boolean(),
  tipo: CategoriaTiposEnum,
});
export type Categoria = z.infer<typeof CategoriaSchema>;

export const CreateCategoriaSchema = z.omit(CategoriaSchema, { id: true, ativo: true });
export type CreateCategoriaPayload = z.infer<typeof CreateCategoriaSchema>;

export const UpdateCategoriaSchema = z.extend(z.omit(CategoriaSchema, { ativo: true }), {
  ativo: z.optional(z.boolean()),
});
export type UpdateCategoriaPayload = z.infer<typeof UpdateCategoriaSchema>;
