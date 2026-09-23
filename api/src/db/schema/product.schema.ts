import { mysqlTable, varchar, boolean, decimal, double, timestamp } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";
import { categorias } from "./categoria.schema";

export const produtos = mysqlTable("produtos", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  name: varchar("name", { length: 255 }).notNull(),
  ativo: boolean("ativo").notNull(),
  sku: varchar("sku", { length: 255 }).notNull(),
  categoriaId: varchar("categoria_id", { length: 36 }).notNull().references(() => categorias.id),
  valorDeCusto: decimal("valor_de_custo", { mode: "number", precision: 10, scale: 2 }).notNull(),
  icms: double("icms").notNull(),
  valorDeVenda: decimal("valor_de_venda", { mode: "number", precision: 10, scale: 2 }).notNull(),
  dataDeCadastro: timestamp("data_de_cadastro").notNull(),
  quantidadeEmEstoque: double("quantidade_em_estoque").notNull(),
});

