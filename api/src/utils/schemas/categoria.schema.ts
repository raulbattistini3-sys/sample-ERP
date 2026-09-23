import { z } from "zod";
import categoriasNomesEnum from "../../enums/categorias_nomes.enum";
import categoriasTiposEnum from "../../enums/categorias_tipos.enum";

const CategoriaBaseSchema = z.object({
   nome: categoriasNomesEnum,   // use the zod enum directly — see note below
   ativo: z.boolean().default(true),
   tipo: categoriasTiposEnum,
});

const CreateCategoriaSchema = CategoriaBaseSchema;

const UpdateCategoriaSchema = CategoriaBaseSchema.extend({
   id: z.string().uuid().nonempty("É necessário prover um ID"),
});

export { CreateCategoriaSchema, UpdateCategoriaSchema };
