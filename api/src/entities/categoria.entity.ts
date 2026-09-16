import { InferSelectModel } from "drizzle-orm";
import { categorias } from "../db/schema";
export type Categoria = InferSelectModel<typeof categorias>;
