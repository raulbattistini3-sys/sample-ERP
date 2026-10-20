import { Categoria } from "../../entities/categoria.entity";

// how every categoria endpoint returns a categoria; picks the public fields explicitly
type CategoriaResponseDto = Pick<Categoria, "id" | "nome" | "ativo" | "tipo">;

export { CategoriaResponseDto };
