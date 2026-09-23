import { mysqlTable, varchar, decimal, timestamp } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";

export const detalhamentosAuditoria = mysqlTable("detalhamentos_auditoria", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  nomeDoProduto: varchar("nome_do_produto", { length: 255 }).notNull(),
  valorAnterior: decimal("valor_anterior", { precision: 10, scale: 2 }).notNull(), // no mode:"number" — stays string, matches original
  valorAtual: decimal("valor_atual", { precision: 10, scale: 2 }).notNull(),
  observacoesAdicionais: varchar("observacoes_adicionais", { length: 1000 }).notNull(),
  deletedAt: timestamp("deleted_at"),
});


