// db/schema/usuario.schema.ts — no import of auditoria at all now
import { mysqlTable, varchar, boolean } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";
import { permissoesUsuarioMysqlEnum } from "./enums.schema";

export const usuarios = mysqlTable("usuarios", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  nome: varchar("nome", { length: 255 }).notNull(),
  permissoes: permissoesUsuarioMysqlEnum("permissoes").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  senha: varchar("senha", { length: 255 }).notNull(),
  ativo: boolean("ativo").notNull(),
});
