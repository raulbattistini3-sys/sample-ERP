import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { auditorias } from "../db/schema";
export type AuditoriaEntity = InferSelectModel<typeof auditorias>;
export type NewAuditoriaEntity = InferInsertModel<typeof auditorias>;
