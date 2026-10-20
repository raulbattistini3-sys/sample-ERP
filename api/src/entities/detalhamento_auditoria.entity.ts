import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { detalhamentosAuditoria } from "../db/schema";
export type DetalhamentoAuditoriaEntity = InferSelectModel<typeof detalhamentosAuditoria>;
export type NewDetalhamentoAuditoriaEntity = InferInsertModel<typeof detalhamentosAuditoria>;
