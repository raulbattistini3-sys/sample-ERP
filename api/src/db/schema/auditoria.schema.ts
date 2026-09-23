// db/schema/auditoria.schema.ts — no import of usuario either
import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";
import { acaoEfetuadaMysqlEnum } from "./enums.schema";

export const auditorias = mysqlTable("auditorias", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  acaoEfetuada: acaoEfetuadaMysqlEnum("acao_efetuada").notNull(),
  dataDeAudicao: timestamp("data_de_audicao").notNull(),
  nomeDoAuditorId: varchar("nome_do_auditor", { length: 36 }).notNull(), // no .references() here anymore either — see note below
  detalhamentoAuditoriaId: varchar("detalhamento_auditoria_id", { length: 36 }),
  deletedAt: timestamp("deleted_at"),
});
