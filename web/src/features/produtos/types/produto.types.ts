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

export const CreateProductSchema = z.omit(ProductSchema, { id: true, ativo: true });
export type CreateProductPayload = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = ProductSchema; // full shape required, matches your PUT /:id
export type UpdateProductPayload = z.infer<typeof UpdateProductSchema>;

const amount = (label: string) =>
  z.number(`Informe ${label}`).check(z.gte(0, `${label[0].toUpperCase()}${label.slice(1)} não pode ser negativo`));

// what the product form validates before building a Create/Update payload
export const ProductFormSchema = z.object({
  name: z.string().check(z.trim(), z.minLength(1, "Informe o nome")),
  sku: z.string().check(z.trim(), z.minLength(1, "Informe o SKU")),
  categoria: CategoriaNomesEnum,
  valor_de_custo: amount("o valor de custo"),
  icms: amount("o ICMS"),
  valor_de_venda: amount("o valor de venda"),
  quantidade_em_estoque: amount("a quantidade"),
});
export type ProductFormValues = z.infer<typeof ProductFormSchema>;
