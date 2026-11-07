// db/schema/usuario.schema.ts — no import of auditoria at all now
import { mysqlTable, varchar, boolean, int } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";
import { permissoesUsuarioMysqlEnum } from "./enums.schema";

export const usuarios = mysqlTable("usuarios", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  nome: varchar("nome", { length: 255 }).notNull(),
  permissoes: permissoesUsuarioMysqlEnum("permissoes").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  senha: varchar("senha", { length: 255 }).notNull(),
  ativo: boolean("ativo").notNull(),
  // stamped into every token as "ver"; bumped when the senha changes, which ends older sessions
  sessaoVersao: int("sessao_versao").notNull().default(0),
  // set on the bootstrap superuser (known password): every route but change-password is refused until it is cleared
  trocaSenhaObrigatoria: boolean("troca_senha_obrigatoria").notNull().default(false),
});
