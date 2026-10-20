import { BaseDefaultMessage } from "../global_get.dto";
import { Categoria } from "../../entities/categoria.entity";

// no id (generated); ativo defaults to true
type PayloadCreateCategoria = Pick<Categoria, "nome" | "tipo"> & { ativo?: boolean };

type NewCategoria = Omit<Categoria, "id">;

type ResponseCreateCategoria = Categoria;

export { PayloadCreateCategoria, ResponseCreateCategoria, NewCategoria };
