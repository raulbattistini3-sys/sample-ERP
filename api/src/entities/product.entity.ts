import { InferSelectModel } from "drizzle-orm";
import { produtos } from "../db/schema";
export type ProductEntity = InferSelectModel<typeof produtos>;
