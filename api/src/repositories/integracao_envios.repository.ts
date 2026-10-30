import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { Provider } from "../configs/oauth.providers";
import { enqueueEnvioJobs } from "../queues/integracao_envios.jobs";

// What each integration must create for new auditorias (drizzle/0006-0009): one row per (auditoria,
// categoria it touches, provider) — a Jira issue, a HubSpot ticket — written on the auditoria's own
// transaction together with its pg-boss job (job_id); a lote gets one row per categoria summing it up
// (enqueueForLote). IntegracaoEnvioWorker runs the jobs and records
// the outcome here, which is also what the pages show.
//
//   pendente -> enviando (worker) -> enviada
//                                 -> erro (pg-boss retries with backoff; after the last attempt
//                                          the job goes to the provider's dead-letter queue)
//                                 -> cancelada (auditoria removed)

// the providers connected and configured enough to receive one; nothing is queued for the others,
// so auditorias made before connecting don't all land at once later
export const INTEGRACAO_PRONTA = sql`(
  (i.provider = 'jira' and i.config ->> 'projectKey' is not null and i.config ->> 'issueTypeId' is not null)
  or (i.provider = 'hubspot' and i.config ->> 'pipelineId' is not null and i.config ->> 'stageId' is not null))`;

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

type InsertedEnvio = { id: string; provider: Provider };
const inserted = (result: { rows: unknown[] }) => result.rows as InsertedEnvio[];

// a product auditoria (manual or automatic): per ready provider, one row (and job) per categoria
export async function enqueueForProducts(tx: DrizzleDB, auditoriaId: string, produtoIds: string[]): Promise<void> {
  if (produtoIds.length === 0) return;
  const result = await tx.execute(sql`
    insert into auditoria_integracao_envios (auditoria_id, categoria_id, categoria_nome, provider)
    select distinct ${auditoriaId}::uuid, c.id, c.nome::text, i.provider
    from produtos p join categorias c on c.id = p.categoria_id cross join integracoes i
    where p.id in (${idList(produtoIds)}) and ${INTEGRACAO_PRONTA}
    on conflict (auditoria_id, categoria_id, provider) do nothing
    returning id, provider::text as provider`);
  await enqueueEnvioJobs(tx, inserted(result));
}

// A lote's auditorias, summed up: per ready provider, one row (and job) per categoria, hanging off one of
// its auditorias. A categoria with a single change has no resumo and keeps the detailed issue. A product
// can count in more than one bucket (price and ICMS changed together). Same statement as the Go importer's
// resumirLote (importer/postgres/produtos.go).
export async function enqueueForLote(tx: DrizzleDB, loteId: string): Promise<void> {
  const result = await tx.execute(sql`
    with alteracoes as (
      select a.id as auditoria_id, c.id as categoria_id, c.nome::text as categoria_nome,
             d.valor_atual > d.valor_anterior as aumento, d.valor_atual < d.valor_anterior as reducao,
             d.alteracoes @> '[{"campo": "ICMS"}]'::jsonb as icms
      from auditorias a
      join detalhamentos_auditoria d on d.id = a.detalhamento_auditoria_id
      join produtos_por_auditoria pa on pa.auditoria_id = a.id
      join produtos p on p.id = pa.produto_id
      join categorias c on c.id = p.categoria_id
      where a.lote_id = ${loteId}
    ),
    por_categoria as (
      select categoria_id, categoria_nome, (array_agg(auditoria_id))[1] as auditoria_id, count(*) as total,
             count(*) filter (where aumento) as aumentos, count(*) filter (where reducao) as reducoes,
             count(*) filter (where icms) as icms, count(*) filter (where not aumento and not reducao and not icms) as outras
      from alteracoes group by categoria_id, categoria_nome
    )
    insert into auditoria_integracao_envios (auditoria_id, categoria_id, categoria_nome, provider, lote_id, resumo)
    select l.auditoria_id, l.categoria_id, l.categoria_nome, i.provider, ${loteId}::uuid,
           case when l.total > 1 then jsonb_build_object('total', l.total, 'aumentos', l.aumentos, 'reducoes', l.reducoes, 'icms', l.icms, 'outras', l.outras) end
    from por_categoria l cross join integracoes i
    where ${INTEGRACAO_PRONTA}
    on conflict (auditoria_id, categoria_id, provider) do nothing
    returning id, provider::text as provider`);
  await enqueueEnvioJobs(tx, inserted(result));
}

// a categoria change: per ready provider, one row (and job) for that categoria, even without products
export async function enqueueForCategoria(tx: DrizzleDB, auditoriaId: string, categoriaId: string): Promise<void> {
  const result = await tx.execute(sql`
    insert into auditoria_integracao_envios (auditoria_id, categoria_id, categoria_nome, provider)
    select ${auditoriaId}::uuid, c.id, c.nome::text, i.provider
    from categorias c cross join integracoes i
    where c.id = ${categoriaId} and ${INTEGRACAO_PRONTA}
    on conflict (auditoria_id, categoria_id, provider) do nothing
    returning id, provider::text as provider`);
  await enqueueEnvioJobs(tx, inserted(result));
}

export type ResumoLote = { total: number; aumentos: number; reducoes: number; icms: number; outras: number };

export type QueuedEnvio = {
  id: string;
  provider: Provider;
  auditoriaId: string;
  categoriaNome: string;
  tentativas: number;
  acao: string;
  dataDeAudicao: number; // epoch ms
  auditor: string | null;
  nomeDoProduto: string | null;
  valorAnterior: string | null;
  valorAtual: string | null;
  observacoes: string | null;
  alteracoes: { campo: string; antes: string; depois: string }[]; // every field the auditoria changed
  produtos: string; // names of the auditoria's products in this categoria
  resumo: ResumoLote | null; // set when this row sums up a lote
  auditoriaRemovida: boolean;
};

export type EnvioStatus = "pendente" | "enviando" | "enviada" | "erro" | "cancelada";

export type AuditoriaEnvio = {
  provider: Provider;
  categoriaNome: string;
  status: EnvioStatus;
  externalId: string | null;
  externalUrl: string | null;
  tentativas: number;
  ultimoErro: string | null;
};

class IntegracaoEnviosRepository {
  constructor(private readonly db: DrizzleDB) {}

  // The worker takes the row before calling the provider. Single statement: a job run twice (pg-boss
  // retries an expired job) only creates one issue/item. null = nothing to do (already sent, being
  // sent within its lease, or cancelled).
  async claimForSend(id: string, leaseMinutes: number): Promise<QueuedEnvio | null> {
    const { rows } = await this.db.execute(sql`
      with claimed as (
        update auditoria_integracao_envios set status = 'enviando', tentativas = tentativas + 1,
          proxima_tentativa_em = now() + make_interval(mins => ${leaseMinutes})
        where id = ${id}
          and (status in ('pendente', 'erro') or (status = 'enviando' and proxima_tentativa_em < now()))
        returning *)
      select j.id, j.provider::text as provider, j.auditoria_id, j.categoria_nome, j.tentativas, j.resumo,
             a.acao_efetuada::text as acao, (extract(epoch from a.data_de_audicao) * 1000)::float8 as data_de_audicao,
             u.nome as auditor, d.nome_do_produto, d.valor_anterior::text as valor_anterior,
             d.valor_atual::text as valor_atual, d.observacoes_adicionais as observacoes,
             coalesce(d.alteracoes, '[]'::jsonb) as alteracoes,
             a.deleted_at is not null as auditoria_removida,
             coalesce((select string_agg(p.name, ', ' order by p.name)
                       from produtos_por_auditoria pa join produtos p on p.id = pa.produto_id
                       where pa.auditoria_id = j.auditoria_id and p.categoria_id = j.categoria_id), '') as produtos
      from claimed j
      join auditorias a on a.id = j.auditoria_id
      left join detalhamentos_auditoria d on d.id = a.detalhamento_auditoria_id
      left join usuarios u on u.id = a.usuario_id`);
    const r = rows[0] as any;
    if (!r) return null;
    return {
      id: r.id,
      provider: r.provider,
      auditoriaId: r.auditoria_id,
      categoriaNome: r.categoria_nome,
      tentativas: Number(r.tentativas),
      acao: r.acao,
      dataDeAudicao: Number(r.data_de_audicao),
      auditor: r.auditor,
      nomeDoProduto: r.nome_do_produto,
      valorAnterior: r.valor_anterior,
      valorAtual: r.valor_atual,
      observacoes: r.observacoes,
      alteracoes: r.alteracoes,
      produtos: r.produtos,
      resumo: r.resumo,
      auditoriaRemovida: r.auditoria_removida,
    };
  }

  async markSent(id: string, externalId: string, externalUrl: string): Promise<void> {
    await this.db.execute(sql`
      update auditoria_integracao_envios set status = 'enviada', external_id = ${externalId},
        external_url = ${externalUrl}, ultimo_erro = null, enviado_em = now()
      where id = ${id}`);
  }

  // retryInMs: roughly when pg-boss runs it again (shown on the pages); null = it gave up
  async markFailed(id: string, message: string, retryInMs: number | null): Promise<void> {
    await this.db.execute(sql`
      update auditoria_integracao_envios set status = 'erro', ultimo_erro = ${message.slice(0, 1000)},
        proxima_tentativa_em = ${retryInMs === null ? sql`now()` : sql`now() + make_interval(secs => ${retryInMs / 1000})`}
      where id = ${id}`);
  }

  async markCancelled(id: string): Promise<void> {
    await this.db.execute(sql`update auditoria_integracao_envios set status = 'cancelada' where id = ${id}`);
  }

  // rows that still need a job (saved while the queue wasn't running, or reset by "Reenviar")
  async listWithoutJob(limit: number): Promise<string[]> {
    const { rows } = await this.db.execute(sql`
      select id from auditoria_integracao_envios where status = 'pendente' and job_id is null
      order by criado_em limit ${limit}`);
    return (rows as { id: string }[]).map((r) => r.id);
  }

  // gives the rows their jobs (on a transaction, so the job and job_id are saved together)
  async enqueueJobs(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let enqueued = 0;
    await this.db.transaction(async (tx: DrizzleDB) => {
      const { rows } = await tx.execute(sql`
        select id, provider::text as provider from auditoria_integracao_envios
        where id in (${idList(ids)}) and status = 'pendente' and job_id is null
        for update skip locked`);
      const pending = rows as InsertedEnvio[];
      if (await enqueueEnvioJobs(tx, pending)) enqueued = pending.length;
    });
    return enqueued;
  }

  async listForAuditoria(auditoriaId: string): Promise<AuditoriaEnvio[]> {
    const { rows } = await this.db.execute(sql`
      select provider::text as provider, categoria_nome, status, external_id, external_url, tentativas, ultimo_erro
      from auditoria_integracao_envios e
      where e.auditoria_id = ${auditoriaId}
        or (e.lote_id = (select lote_id from auditorias where id = ${auditoriaId})
          and e.categoria_id in (
            select p.categoria_id from produtos_por_auditoria pa join produtos p on p.id = pa.produto_id
            where pa.auditoria_id = ${auditoriaId}))
      order by provider, categoria_nome`);
    return (rows as any[]).map((r) => ({
      provider: r.provider,
      categoriaNome: r.categoria_nome,
      status: r.status,
      externalId: r.external_id,
      externalUrl: r.external_url,
      tentativas: Number(r.tentativas),
      ultimoErro: r.ultimo_erro,
    }));
  }

  async summary(provider: Provider, maxAttempts: number): Promise<{
    enviadas: number;
    pendentes: number;
    comErro: number;
    esgotadas: number; // gave up after maxAttempts (job in the dead-letter queue); only "Reenviar" brings them back
    erros: { categoriaNome: string; auditoriaId: string; ultimoErro: string | null; tentativas: number }[];
  }> {
    const { rows } = await this.db.execute(sql`
      select
        count(*) filter (where status = 'enviada')::int as enviadas,
        count(*) filter (where status in ('pendente', 'enviando'))::int as pendentes,
        count(*) filter (where status = 'erro' and tentativas < ${maxAttempts})::int as com_erro,
        count(*) filter (where status = 'erro' and tentativas >= ${maxAttempts})::int as esgotadas
      from auditoria_integracao_envios where provider = ${provider}`);
    const { rows: erros } = await this.db.execute(sql`
      select categoria_nome, auditoria_id, ultimo_erro, tentativas from auditoria_integracao_envios
      where provider = ${provider} and status = 'erro' order by proxima_tentativa_em desc limit 5`);
    const r = rows[0] as any;
    return {
      enviadas: r.enviadas,
      pendentes: r.pendentes,
      comErro: r.com_erro,
      esgotadas: r.esgotadas,
      erros: (erros as any[]).map((e) => ({
        categoriaNome: e.categoria_nome,
        auditoriaId: e.auditoria_id,
        ultimoErro: e.ultimo_erro,
        tentativas: Number(e.tentativas),
      })),
    };
  }

  // "Reenviar": the provider's rows that gave up start over without a job; the worker's sweep gives
  // them one. Rows still within their retries are left alone (pg-boss has their next attempt scheduled).
  async resetExhausted(provider: Provider, maxAttempts: number): Promise<string[]> {
    const { rows } = await this.db.execute(sql`
      update auditoria_integracao_envios set status = 'pendente', tentativas = 0, job_id = null, proxima_tentativa_em = now()
      where provider = ${provider} and status = 'erro' and tentativas >= ${maxAttempts}
      returning id`);
    return (rows as { id: string }[]).map((r) => r.id);
  }
}

export default IntegracaoEnviosRepository;
