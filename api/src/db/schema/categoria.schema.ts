import { mysqlTable, varchar, boolean } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { randomUUID } from "crypto";
import { categoriasNomesMysqlEnum, categoriasTiposMysqlEnum } from "./enums.schema";
import { produtos } from "./product.schema";

export const categorias = mysqlTable("categorias", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  nome: categoriasNomesMysqlEnum("nome").notNull(),
  ativo: boolean("ativo").notNull(),
  tipo: categoriasTiposMysqlEnum("tipo").notNull(),
});

export const categoriasRelations = relations(categorias, ({ many }) => ({
  produtos: many(produtos),
}));
