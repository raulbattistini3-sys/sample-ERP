// db/schema/produtos_por_auditoria.schema.ts
import { mysqlTable, varchar, primaryKey } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { auditorias } from "./auditoria.schema";
import { produtos } from "./product.schema";

export const produtosPorAuditoria = mysqlTable("produtos_por_auditoria", {
  auditoriaId: varchar("auditoria_id", { length: 36 }).notNull().references(() => auditorias.id),
  produtoId: varchar("produto_id", { length: 36 }).notNull().references(() => produtos.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.auditoriaId, table.produtoId] }),
}));

export const produtosPorAuditoriaRelations = relations(produtosPorAuditoria, ({ one }) => ({
  auditoria: one(auditorias, {
    fields: [produtosPorAuditoria.auditoriaId],
    references: [auditorias.id],
  }),
  produto: one(produtos, {
    fields: [produtosPorAuditoria.produtoId],
    references: [produtos.id],
  }),
}));
