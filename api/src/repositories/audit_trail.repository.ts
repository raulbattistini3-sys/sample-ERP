import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// Automatic "Alteracao" auditorias for product and categoria changes. Every function runs on the
// caller's transaction, so a change is never saved without its auditoria (or a claimed manual one).
//
// A manual auditoria covers a change when it's an unused (vinculada_em IS NULL) "Alteracao" created
// in the last 24 hours (criada_em) that matches it:
//   - product: linked to the product, valor_anterior/valor_atual = valor de venda before/after
//   - categoria: detalhamento named "Categoria: <nome before or after>"
// Claiming sets vinculada_em in the same UPDATE that finds the row (FOR UPDATE SKIP LOCKED), so two
// concurrent changes can't both use one manual auditoria. Otherwise an automatic auditoria is created,
// already vinculada, so it can't cover a later change either.

export type FieldChange = { campo: string; antes: string; depois: string };

// the row as saved: like the UPDATE, undefined fields in `values` keep their stored value
export const applyChanges = <T extends object>(before: T, values: Partial<T>): T => ({
  ...before,
  ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
});

export type AuditOutcome = { auditoriaId: string; automatica: boolean };

const MATCH_WINDOW = sql`interval '24 hours'`;
const MAX_OBSERVACOES = 1000;

const observacoes = (changes: FieldChange[]) => {
  const text = `Alteração registrada automaticamente. ${changes
    .map(({ campo, antes, depois }) => `${campo}: ${antes} → ${depois}`)
    .join("; ")}`;
  return text.length > MAX_OBSERVACOES ? `${text.slice(0, MAX_OBSERVACOES - 1)}…` : text;
};

const firstId = (result: { rows: { id: string }[] }) => result.rows[0]?.id as string | undefined;

async function createAutomaticAuditoria(
  tx: DrizzleDB,
  usuarioId: string,
  nome: string,
  valorAnterior: string,
  valorAtual: string,
  changes: FieldChange[],
  produtoIds: string[],
): Promise<string> {
  const detalhamentoId = firstId(
    await tx.execute(sql`
      insert into detalhamentos_auditoria (nome_do_produto, valor_anterior, valor_atual, observacoes_adicionais)
      values (${nome}, ${valorAnterior}::numeric, ${valorAtual}::numeric, ${observacoes(changes)})
      returning id`),
  )!;
  const auditoriaId = firstId(
    await tx.execute(sql`
      insert into auditorias (acao_efetuada, data_de_audicao, usuario_id, detalhamento_auditoria_id, vinculada_em)
      values ('Alteracao', now(), ${usuarioId}, ${detalhamentoId}, now())
      returning id`),
  )!;
  for (const produtoId of produtoIds) {
    await tx.execute(sql`insert into produtos_por_auditoria (auditoria_id, produto_id) values (${auditoriaId}, ${produtoId})`);
  }
  return auditoriaId;
}

export async function recordProductChange(
  tx: DrizzleDB,
  change: {
    usuarioId: string;
    produtoId: string;
    nomeProduto: string;
    vendaAntes: number;
    vendaDepois: number;
    changes: FieldChange[];
  },
): Promise<AuditOutcome | null> {
  if (change.changes.length === 0) return null;
  const antes = change.vendaAntes.toFixed(2);
  const depois = change.vendaDepois.toFixed(2);

  const claimed = firstId(
    await tx.execute(sql`
      update auditorias set vinculada_em = now()
      where id = (
        select a.id
        from auditorias a
        join produtos_por_auditoria pa on pa.auditoria_id = a.id
        join detalhamentos_auditoria d on d.id = a.detalhamento_auditoria_id
        where pa.produto_id = ${change.produtoId}
          and a.acao_efetuada = 'Alteracao'
          and a.deleted_at is null
          and a.vinculada_em is null
          and a.criada_em > now() - ${MATCH_WINDOW}
          and d.valor_anterior = ${antes}::numeric
          and d.valor_atual = ${depois}::numeric
        order by a.criada_em
        limit 1
        for update of a skip locked
      )
      returning id`),
  );
  if (claimed) return { auditoriaId: claimed, automatica: false };

  const auditoriaId = await createAutomaticAuditoria(
    tx, change.usuarioId, change.nomeProduto, antes, depois, change.changes, [change.produtoId],
  );
  return { auditoriaId, automatica: true };
}

export async function recordCategoriaChange(
  tx: DrizzleDB,
  change: {
    usuarioId: string;
    categoriaId: string;
    nomeAntes: string;
    nomeDepois: string;
    changes: FieldChange[];
  },
): Promise<AuditOutcome | null> {
  if (change.changes.length === 0) return null;
  const nomes = [`categoria: ${change.nomeAntes}`.toLowerCase(), `categoria: ${change.nomeDepois}`.toLowerCase()];

  const claimed = firstId(
    await tx.execute(sql`
      update auditorias set vinculada_em = now()
      where id = (
        select a.id
        from auditorias a
        join detalhamentos_auditoria d on d.id = a.detalhamento_auditoria_id
        where a.acao_efetuada = 'Alteracao'
          and a.deleted_at is null
          and a.vinculada_em is null
          and a.criada_em > now() - ${MATCH_WINDOW}
          and lower(trim(d.nome_do_produto)) in (${nomes[0]}, ${nomes[1]})
        order by a.criada_em
        limit 1
        for update of a skip locked
      )
      returning id`),
  );
  if (claimed) return { auditoriaId: claimed, automatica: false };

  // the categoria's products, so the auditoria shows up for each of them
  const produtos = await tx.execute(sql`select id from produtos where categoria_id = ${change.categoriaId}`);
  const auditoriaId = await createAutomaticAuditoria(
    tx, change.usuarioId, `Categoria: ${change.nomeDepois}`, "0.00", "0.00", change.changes,
    (produtos.rows as { id: string }[]).map((p) => p.id),
  );
  return { auditoriaId, automatica: true };
}

// ---- diffs ---------------------------------------------------------------------------------------

const money = (value: number) => Number(value).toFixed(2).replace(".", ",");
const status = (ativo: boolean) => (ativo ? "Ativo" : "Inativo");

type ProductSnapshot = {
  name: string;
  sku: string;
  categoriaNome: string;
  valorDeCusto: number;
  icms: number;
  valorDeVenda: number;
  quantidadeEmEstoque: number;
  ativo: boolean;
};

export function diffProduct(before: ProductSnapshot, after: ProductSnapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  const add = (campo: string, a: string, b: string) => a !== b && changes.push({ campo, antes: a, depois: b });
  add("Nome", before.name, after.name);
  add("SKU", before.sku, after.sku);
  add("Categoria", before.categoriaNome, after.categoriaNome);
  add("Valor de custo", money(before.valorDeCusto), money(after.valorDeCusto));
  add("ICMS", String(Number(before.icms)), String(Number(after.icms)));
  add("Valor de venda", money(before.valorDeVenda), money(after.valorDeVenda));
  add("Estoque", String(Number(before.quantidadeEmEstoque)), String(Number(after.quantidadeEmEstoque)));
  add("Status", status(before.ativo), status(after.ativo));
  return changes;
}

export function diffCategoria(
  before: { nome: string; tipo: string; ativo: boolean },
  after: { nome: string; tipo: string; ativo: boolean },
): FieldChange[] {
  const changes: FieldChange[] = [];
  const add = (campo: string, a: string, b: string) => a !== b && changes.push({ campo, antes: a, depois: b });
  add("Nome", before.nome, after.nome);
  add("Tipo", before.tipo, after.tipo);
  add("Status", status(before.ativo), status(after.ativo));
  return changes;
}
