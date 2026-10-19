import { z } from "zod/mini";
import { CategoriaNomesEnum } from "../../categoria/types/categoria.types";

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  ativo: z.boolean(),
  sku: z.string(),
  categoria: z.object({ nome: CategoriaNomesEnum }), // matches your backend's nested-categoria create/update shape
  valor_de_custo: z.number(),
  icms: z.number(),
  valor_de_venda: z.number(),
  data_de_cadastro: z.string(), // ISO string over the wire — see note below
  quantidade_em_estoque: z.number(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductSchema = ProductSchema.omit({ id: true, ativo: true });
export type CreateProductPayload = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = ProductSchema; // full shape required, matches your PUT /:id
export type UpdateProductPayload = z.infer<typeof UpdateProductSchema>;
