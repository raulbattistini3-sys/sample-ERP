import { Categoria } from "../../entities/categoria.entity";
import { BaseDefaultMessage } from "../global_get.dto";

type ResponseArchiveCategory = BaseDefaultMessage & Omit<Categoria, "tipo">;

export { ResponseArchiveCategory };