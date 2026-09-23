import { relations } from "drizzle-orm";
import { usuarios } from "./usuario.schema";
import { auditorias } from "./auditoria.schema";
import { detalhamentosAuditoria } from "./detalhamento_auditoria.schema";
import { produtos } from "./product.schema";
import { categorias } from "./categoria.schema";
import { produtosPorAuditoria } from "./produtos_por_auditoria.schema";

export const usuariosRelations = relations(usuarios, ({ one }) => ({
  auditoriaRealizada: one(auditorias, {
    fields: [usuarios.id],
    references: [auditorias.nomeDoAuditorId],
  }),
}));

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

export const categoriasRelations = relations(categorias, ({ many }) => ({
  produtos: many(produtos),
}));

export const produtosRelations = relations(produtos, ({ one, many }) => ({
  categoria: one(categorias, {
    fields: [produtos.categoriaId],
    references: [categorias.id],
  }),
  auditorias: many(produtosPorAuditoria),
}));


export const detalhamentosAuditoriaRelations = relations(detalhamentosAuditoria, ({ one }) => ({
  auditoria: one(auditorias, {
    fields: [detalhamentosAuditoria.id],
    references: [auditorias.detalhamentoAuditoriaId],
  }),
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

