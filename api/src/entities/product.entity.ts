import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { produtos } from "../db/schema";
import { Categoria } from "./categoria.entity";
export type ProductEntity = InferSelectModel<typeof produtos>;
export type NewProductEntity = InferInsertModel<typeof produtos>;

// a product row joined with its category
export type ProductWithCategoria = { produto: ProductEntity; categoria: Categoria };
