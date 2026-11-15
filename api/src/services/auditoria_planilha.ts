import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { AuditoriaFilters } from "../utils/schemas/list_filters.schema";

// "Baixar planilha" on the Auditorias page: the auditorias (the list's filters, or one by id) as a CSV
// for Excel/LibreOffice in pt-BR (";" between columns, decimal comma, UTF-8 BOM), one line per product
// and changed field, so a grouped auditoria can be checked line by line against another source.

const SEP = ";";
const campo = (v: unknown) => {
   const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
   return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CABECALHO = [
   "Auditoria", "Data", "Ação", "Auditor", "E-mail do auditor", "Detalhamento", "Produto", "SKU", "Categoria",
   "Campo", "Antes", "Depois", "Observações",
];

type Linha = {
   id: string; data: Date | string; acao: string; auditor: string | null; email: string | null; detalhe: string | null;
   observacoes: string | null; alteracoes: { campo: string; antes: string; depois: string; produto?: string; produtoId?: string }[] | null;
   produtos: { id: string; nome: string; sku: string; categoria: string | null }[] | null;
};

export async function planilhaDeAuditorias(db: DrizzleDB, filtros: AuditoriaFilters, id?: string): Promise<string> {
   const acao = filtros.acao?.length ? filtros.acao : null;
   const auditor = filtros.auditor?.length ? filtros.auditor : null;
   const { rows } = await db.execute(sql`
      select a.id::text, a.data_de_audicao as data, a.acao_efetuada::text as acao, u.nome as auditor, u.email,
             d.nome_do_produto as detalhe, d.observacoes_adicionais as observacoes, d.alteracoes,
             (select coalesce(json_agg(json_build_object('id', p.id::text, 'nome', p.name, 'sku', p.sku, 'categoria', c.nome) order by p.name), '[]')
                from produtos_por_auditoria pa
                join produtos p on p.id = pa.produto_id
                left join categorias c on c.id = p.categoria_id
               where pa.auditoria_id = a.id) as produtos
      from auditorias a
      left join usuarios u on u.id = a.usuario_id
      left join detalhamentos_auditoria d on d.id = a.detalhamento_auditoria_id
      where a.deleted_at is null
        ${id ? sql`and a.id = ${id}::uuid` : sql``}
        ${acao ? sql`and a.acao_efetuada::text = any(${sql.param(acao)}::text[])` : sql``}
        ${auditor ? sql`and a.usuario_id::text = any(${sql.param(auditor)}::text[])` : sql``}
      order by a.data_de_audicao desc`);

   const out: unknown[][] = [CABECALHO];
   for (const l of rows as Linha[]) {
      const produtos = l.produtos ?? [];
      const porId = new Map(produtos.map((p) => [p.id, p]));
      const base = [l.id, new Date(l.data).toISOString(), l.acao, l.auditor, l.email, l.detalhe];
      const alteracoes = l.alteracoes ?? [];
      if (alteracoes.length === 0) {
         // no field list (a manual auditoria): one line per product, or one for the auditoria
         for (const p of produtos.length ? produtos : [null]) out.push([...base, p?.nome, p?.sku, p?.categoria, "", "", "", l.observacoes]);
         continue;
      }
      for (const c of alteracoes) {
         // tagged: that product's change; untagged with one product: that product; else the categoria/auditoria itself
         const p = c.produtoId ? porId.get(c.produtoId) : produtos.length === 1 ? produtos[0] : undefined;
         out.push([...base, p?.nome ?? c.produto ?? "", p?.sku ?? "", p?.categoria ?? "", c.campo, c.antes, c.depois, l.observacoes]);
      }
   }
   return "﻿" + out.map((r) => r.map(campo).join(SEP)).join("\r\n");
}
