import { Categoria } from "../../entities/categoria.entity";
import { BaseDefaultMessage } from "../global_get.dto";

type PayloadUpdateCategory = Categoria;

type ResponseUpdateCategory = BaseDefaultMessage & Omit<Categoria, "id">;

export { PayloadUpdateCategory, ResponseUpdateCategory };
