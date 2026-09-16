import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { randomUUID } from "crypto";
import { acaoEfetuadaMysqlEnum } from "./enums.schema";
import { usuarios } from "./usuario.schema";
import { detalhamentosAuditoria } from "./detalhamento_auditoria.schema";
import { produtosPorAuditoria } from "./produtos_por_auditoria.schema";

export const auditorias = mysqlTable("auditorias", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  acaoEfetuada: acaoEfetuadaMysqlEnum("acao_efetuada").notNull(),
  dataDeAudicao: timestamp("data_de_audicao").notNull(),
  nomeDoAuditorId: varchar("nome_do_auditor", { length: 36 }).notNull().references(() => usuarios.id),
  detalhamentoAuditoriaId: varchar("detalhamento_auditoria_id", { length: 36 }).references(() => detalhamentosAuditoria.id),
  deletedAt: timestamp("deleted_at"),
});

export const auditoriasRelations = relations(auditorias, ({ one, many }) => ({
  auditor: one(usuarios, {
    fields: [auditorias.nomeDoAuditorId],
    references: [usuarios.id],
  }),
  detalhamento: one(detalhamentosAuditoria, {
    fields: [auditorias.detalhamentoAuditoriaId],
    references: [detalhamentosAuditoria.id],
  }),
  itens: many(produtosPorAuditoria),
}));
