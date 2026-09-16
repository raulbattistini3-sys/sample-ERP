import { InferSelectModel } from "drizzle-orm";
import { usuarios } from "../db/schema";

export type UsuarioEntity = InferSelectModel<typeof usuarios>;
