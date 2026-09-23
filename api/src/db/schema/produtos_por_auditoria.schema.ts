import { mysqlTable, varchar, primaryKey } from "drizzle-orm/mysql-core";
import { auditorias } from "./auditoria.schema";
import { produtos } from "./product.schema";

export const produtosPorAuditoria = mysqlTable("produtos_por_auditoria", {
  auditoriaId: varchar("auditoria_id", { length: 36 }).notNull().references(() => auditorias.id),
  produtoId: varchar("produto_id", { length: 36 }).notNull().references(() => produtos.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.auditoriaId, table.produtoId] }),
}));


