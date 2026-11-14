import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { enqueueForCategoria, enqueueForLote, enqueueForProducts } from "./integracao_envios.repository";

// Automatic "Alteracao" auditorias for product and categoria changes. The record* functions run on the
// caller's transaction, so a change is never saved without either a claimed manual auditoria or a row in
// alteracoes_pendentes (drizzle/0026), which consolidarPendentes turns into auditorias on a schedule
// (AuditoriaConsolidacaoWorker, every 5 minutes by default): one lote per user and action, so the
// integrations get one issue/ticket per categoria instead of one per edit.
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

export type LinkedAuditoria = {
  acao: string;
  dataDeAudicao: Date | null; // null = now()
  usuarioId: string;
  nome: string; // detalhamento's nome_do_produto ("Categoria: <nome>" for a categoria change)
  valorAnterior: string;
  valorAtual: string;
  observacoes: string;
  changes: FieldChange[];
  produtoIds: string[];
  categoriaId: string | null; // set for a categoria change: its issues/items go to that categoria
};

// An auditoria already tied (vinculada) to the change it describes, so it can't cover a later one.
// Used by automatic auditorias and by manual ones that apply their own changes.
export async function insertLinkedAuditoria(tx: DrizzleDB, a: LinkedAuditoria): Promise<string> {
  const detalhamentoId = firstId(
    await tx.execute(sql`
      insert into detalhamentos_auditoria (nome_do_produto, valor_anterior, valor_atual, observacoes_adicionais, alteracoes)
      values (${a.nome}, ${a.valorAnterior}::numeric, ${a.valorAtual}::numeric, ${a.observacoes}, ${JSON.stringify(a.changes)}::jsonb)
      returning id`),
  )!;
  const auditoriaId = firstId(
    await tx.execute(sql`
      insert into auditorias (acao_efetuada, data_de_audicao, usuario_id, detalhamento_auditoria_id, vinculada_em)
      values (${a.acao}, ${a.dataDeAudicao ?? sql`now()`}, ${a.usuarioId}, ${detalhamentoId}, now())
      returning id`),
  )!;
  for (const produtoId of a.produtoIds) {
    await tx.execute(sql`insert into produtos_por_auditoria (auditoria_id, produto_id) values (${auditoriaId}, ${produtoId})`);
  }
  // issues/items of the connected integrations for the new auditoria, created after commit
  if (a.categoriaId) await enqueueForCategoria(tx, auditoriaId, a.categoriaId);
  else await enqueueForProducts(tx, auditoriaId, a.produtoIds);
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

  await enfileirar(tx, change.usuarioId, GRUPO_EDICAO, [
    { produtoId: change.produtoId, nomeProduto: change.nomeProduto, antes, depois, changes: change.changes },
  ]);
  return null;
}

// ---- queue (alteracoes_pendentes) ----------------------------------------------------------------

// single edits of a user share one lote per sweep; a bulk action is a lote of its own
const GRUPO_EDICAO = "edicao";
const GRUPO_CATEGORIA = "categoria";
const grupoDeLote = () => `lote:${randomUUID()}`;

type Pendente = { produtoId: string; nomeProduto: string; antes: string; depois: string; changes: FieldChange[] };

async function enfileirar(tx: DrizzleDB, usuarioId: string, grupo: string, itens: Pendente[]): Promise<void> {
  for (const lote of emLotes(itens)) {
    await tx.execute(sql`
      insert into alteracoes_pendentes (usuario_id, grupo, produto_id, nome, venda_antes, venda_depois, alteracoes)
      select ${usuarioId}::uuid, ${grupo}, produto, nome, antes, depois, alteracoes::jsonb
      from unnest(
        ${arrayParam(lote.map((n) => n.produtoId))}::uuid[],
        ${arrayParam(lote.map((n) => n.nomeProduto))}::text[],
        ${arrayParam(lote.map((n) => n.antes))}::numeric[],
        ${arrayParam(lote.map((n) => n.depois))}::numeric[],
        ${arrayParam(lote.map((n) => JSON.stringify(n.changes)))}::text[]
      ) as v(produto, nome, antes, depois, alteracoes)`);
  }
}

// rows per statement of a bulk write: one array parameter per column, so only the statement's size is at stake
const BULK_BATCH = 5000;

export type ProductChange = {
  produtoId: string;
  nomeProduto: string;
  vendaAntes: number;
  vendaDepois: number;
  changes: FieldChange[];
};

const emLotes = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / BULK_BATCH) }, (_, i) => items.slice(i * BULK_BATCH, (i + 1) * BULK_BATCH));

const arrayParam = (values: unknown[]) => sql.param(values);

// recordProductChange for many products, in a few statements however many there are: the same outcome,
// but a round trip per product doesn't fit a big spreadsheet. A manual auditoria can be linked to several
// products, so the candidates are read first and handed out in order, oldest first, each only once.
// The new auditorias are one lote: the integrations get one issue/ticket per categoria summing it up.
export async function recordProductChanges(tx: DrizzleDB, usuarioId: string, items: ProductChange[]): Promise<void> {
  const changed = items
    .filter(({ changes }) => changes.length > 0)
    .map((item) => ({ ...item, antes: item.vendaAntes.toFixed(2), depois: item.vendaDepois.toFixed(2) }));
  if (changed.length === 0) return;

  const { rows: candidatas } = await tx.execute(sql`
    select a.id, pa.produto_id, d.valor_anterior::text as antes, d.valor_atual::text as depois
    from auditorias a
    join produtos_por_auditoria pa on pa.auditoria_id = a.id
    join detalhamentos_auditoria d on d.id = a.detalhamento_auditoria_id
    where pa.produto_id = any(${arrayParam(changed.map((c) => c.produtoId))}::uuid[])
      and a.acao_efetuada = 'Alteracao'
      and a.deleted_at is null
      and a.vinculada_em is null
      and a.criada_em > now() - ${MATCH_WINDOW}
    order by a.criada_em
    for update of a skip locked`);
  const porChave = new Map<string, string[]>();
  for (const c of candidatas as { id: string; produto_id: string; antes: string; depois: string }[]) {
    const chave = `${c.produto_id}|${c.antes}|${c.depois}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), c.id]);
  }

  const reivindicadas = new Set<string>();
  const novas: Pendente[] = [];
  for (const item of changed) {
    const opcoes = porChave.get(`${item.produtoId}|${item.antes}|${item.depois}`) ?? [];
    const manual = opcoes.find((id) => !reivindicadas.has(id));
    if (manual) reivindicadas.add(manual);
    else novas.push(item);
  }

  if (reivindicadas.size > 0) {
    await tx.execute(sql`update auditorias set vinculada_em = now() where id = any(${arrayParam([...reivindicadas])}::uuid[])`);
  }
  // all of this action's products in one group: the sweep makes them one lote
  if (novas.length > 0) await enfileirar(tx, usuarioId, novas.length > 1 ? grupoDeLote() : GRUPO_EDICAO, novas);
}

// A lote of product auditorias, in a few statements however many there are, then one integration
// issue/ticket per categoria (enqueueForLote). Returns how many auditorias were created.
async function inserirLote(tx: DrizzleDB, usuarioId: string, dataDeAudicao: Date, itens: Pendente[]): Promise<number> {
  const novas = itens.map((item) => ({ ...item, auditoriaId: randomUUID(), detalhamentoId: randomUUID() }));
  const loteId = randomUUID();
  for (const lote of emLotes(novas)) {
    await tx.execute(sql`
      insert into detalhamentos_auditoria (id, nome_do_produto, valor_anterior, valor_atual, observacoes_adicionais, alteracoes)
      select id, nome, antes, depois, obs, alteracoes::jsonb
      from unnest(
        ${arrayParam(lote.map((n) => n.detalhamentoId))}::uuid[],
        ${arrayParam(lote.map((n) => n.nomeProduto))}::text[],
        ${arrayParam(lote.map((n) => n.antes))}::numeric[],
        ${arrayParam(lote.map((n) => n.depois))}::numeric[],
        ${arrayParam(lote.map((n) => observacoes(n.changes)))}::text[],
        ${arrayParam(lote.map((n) => JSON.stringify(n.changes)))}::text[]
      ) as v(id, nome, antes, depois, obs, alteracoes)`);
    await tx.execute(sql`
      insert into auditorias (id, acao_efetuada, data_de_audicao, usuario_id, detalhamento_auditoria_id, vinculada_em, lote_id)
      select id, 'Alteracao', ${dataDeAudicao.toISOString()}::timestamptz, ${usuarioId}, detalhamento, now(), ${loteId}::uuid
      from unnest(
        ${arrayParam(lote.map((n) => n.auditoriaId))}::uuid[],
        ${arrayParam(lote.map((n) => n.detalhamentoId))}::uuid[]
      ) as v(id, detalhamento)`);
    await tx.execute(sql`
      insert into produtos_por_auditoria (auditoria_id, produto_id)
      select * from unnest(
        ${arrayParam(lote.map((n) => n.auditoriaId))}::uuid[],
        ${arrayParam(lote.map((n) => n.produtoId))}::uuid[]
      )`);
  }
  if (novas.length > 0) await enqueueForLote(tx, loteId);
  return novas.length;
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

  await tx.execute(sql`
    insert into alteracoes_pendentes (usuario_id, grupo, categoria_id, nome, alteracoes)
    values (${change.usuarioId}, ${GRUPO_CATEGORIA}, ${change.categoriaId}, ${`Categoria: ${change.nomeDepois}`}, ${JSON.stringify(change.changes)}::jsonb)`);
  return null;
}

// ---- consolidation -------------------------------------------------------------------------------

type LinhaPendente = {
  usuario_id: string;
  grupo: string;
  produto_id: string | null;
  categoria_id: string | null;
  nome: string;
  venda_antes: string;
  venda_depois: string;
  alteracoes: FieldChange[];
  criada_em: Date | string;
};

// Several edits of the same field in the window: the first "antes" and the last "depois". A field that
// came back to its value drops out, and so does an edit that undid itself entirely.
export function juntarAlteracoes(listas: FieldChange[][]): FieldChange[] {
  const porCampo = new Map<string, FieldChange>();
  for (const lista of listas) {
    for (const { campo, antes, depois } of lista) {
      const atual = porCampo.get(campo);
      porCampo.set(campo, { campo, antes: atual ? atual.antes : antes, depois });
    }
  }
  return [...porCampo.values()].filter(({ antes, depois }) => antes !== depois);
}

export type Consolidacao = { pendentes: number; auditorias: number; lotes: number };

const agrupar = <T>(itens: T[], chave: (item: T) => string) => {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const grupo = grupos.get(k);
    if (grupo) grupo.push(item);
    else grupos.set(k, [item]);
  }
  return grupos;
};

// Turns up to `limite` queued changes (oldest first) into auditorias, on the caller's transaction: the
// rows are taken FOR UPDATE SKIP LOCKED and deleted, so two API instances never consolidate one change.
export async function consolidarPendentes(tx: DrizzleDB, limite: number): Promise<Consolidacao> {
  const { rows } = await tx.execute(sql`
    delete from alteracoes_pendentes
    where id in (select id from alteracoes_pendentes order by criada_em limit ${limite} for update skip locked)
    returning usuario_id::text, grupo, produto_id::text, categoria_id::text, nome, venda_antes::text,
              venda_depois::text, alteracoes, criada_em`);
  const linhas = (rows as LinhaPendente[]).sort((a, b) => +new Date(a.criada_em) - +new Date(b.criada_em));
  const resultado: Consolidacao = { pendentes: linhas.length, auditorias: 0, lotes: 0 };

  const grupos = agrupar(linhas, (l) =>
    l.categoria_id ? `${l.usuario_id}|categoria|${l.categoria_id}` : `${l.usuario_id}|${l.grupo}`,
  );
  for (const grupo of grupos.values()) {
    const { usuario_id: usuarioId, categoria_id: categoriaId } = grupo[0];
    const dataDeAudicao = new Date(grupo[0].criada_em);
    const ultima = grupo[grupo.length - 1];

    if (categoriaId) {
      const changes = juntarAlteracoes(grupo.map((l) => l.alteracoes));
      if (changes.length === 0) continue;
      // the categoria's products, so the auditoria shows up for each of them
      const produtos = await tx.execute(sql`select id from produtos where categoria_id = ${categoriaId}`);
      await insertLinkedAuditoria(tx, {
        acao: "Alteracao",
        dataDeAudicao,
        usuarioId,
        nome: ultima.nome,
        valorAnterior: "0.00",
        valorAtual: "0.00",
        observacoes: observacoes(changes),
        changes,
        produtoIds: (produtos.rows as { id: string }[]).map((p) => p.id),
        categoriaId,
      });
      resultado.auditorias += 1;
      resultado.lotes += 1;
      continue;
    }

    const itens: Pendente[] = [];
    for (const [produtoId, edicoes] of agrupar(grupo, (l) => l.produto_id!)) {
      const changes = juntarAlteracoes(edicoes.map((l) => l.alteracoes));
      if (changes.length === 0) continue;
      itens.push({
        produtoId,
        nomeProduto: edicoes[edicoes.length - 1].nome,
        antes: edicoes[0].venda_antes,
        depois: edicoes[edicoes.length - 1].venda_depois,
        changes,
      });
    }
    if (itens.length === 0) continue;
    resultado.auditorias += await inserirLote(tx, usuarioId, dataDeAudicao, itens);
    resultado.lotes += 1;
  }
  return resultado;
}

export async function contarPendentes(db: DrizzleDB): Promise<{ total: number; desde: string | null }> {
  const { rows } = await db.execute(sql`select count(*)::int as total, min(criada_em) as desde from alteracoes_pendentes`);
  const [linha] = rows as { total: number; desde: Date | string | null }[];
  return { total: linha?.total ?? 0, desde: linha?.desde ? new Date(linha.desde).toISOString() : null };
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
