import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { produtos } from "../db/schema";
export type ProductEntity = InferSelectModel<typeof produtos>;
export type NewProductEntity = InferInsertModel<typeof produtos>;
