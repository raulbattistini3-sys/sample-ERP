import { CategoriaResponseDto } from "../dtos/category_dtos/categoria_response.dto";
import { Categoria } from "../entities/categoria.entity";

export const toCategoriaResponse = (categoria: Categoria): CategoriaResponseDto => ({
   id: categoria.id,
   nome: categoria.nome,
   ativo: categoria.ativo,
   tipo: categoria.tipo,
});
