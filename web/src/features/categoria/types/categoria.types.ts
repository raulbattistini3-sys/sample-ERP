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

export const CreateCategoriaSchema = CategoriaSchema.omit({ id: true, ativo: true });
export type CreateCategoriaPayload = z.infer<typeof CreateCategoriaSchema>;

export const UpdateCategoriaSchema = CategoriaSchema.omit({ ativo: true }).extend({
  ativo: z.optional(z.boolean()), // function form — .optional() doesn't exist as a method in mini
});
export type UpdateCategoriaPayload = z.infer<typeof UpdateCategoriaSchema>;
