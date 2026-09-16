// db/schema/usuario.schema.ts
import { mysqlTable, varchar, boolean } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { randomUUID } from "crypto";
import { permissoesUsuarioMysqlEnum } from "./enums.schema";
import { auditorias } from "./auditoria.schema";

export const usuarios = mysqlTable("usuarios", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  nome: varchar("nome", { length: 255 }).notNull(),
  permissoes: permissoesUsuarioMysqlEnum("permissoes").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  senha: varchar("senha", { length: 255 }).notNull(),
  ativo: boolean("ativo").notNull(),
});

export const usuariosRelations = relations(usuarios, ({ one }) => ({
  auditoriaRealizada: one(auditorias, {
    fields: [usuarios.id],
    references: [auditorias.nomeDoAuditorId],
  }),
}));
