import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { enqueueJiraIssueJobs } from "../queues/jira_issues.jobs";

// Jira issues for new auditorias (drizzle/0006-0008): one row per (auditoria, categoria it touches),
// written on the auditoria's own transaction together with its pg-boss job (job_id), so neither can
// exist without the other. JiraIssueWorker runs the jobs and records the outcome here, which is also
// what the pages show.
//
//   pendente -> enviando (worker) -> enviada
//                                 -> erro (pg-boss retries it with backoff; after the last attempt
//                                          the job goes to the dead-letter queue)
//                                 -> cancelada (auditoria removed)

// only while Jira is connected and has a project and issue type chosen; otherwise nothing is queued,
// so auditorias made before connecting don't all land in Jira at once later
const JIRA_READY = sql`exists (
  select 1 from integracoes
  where provider = 'jira' and config ->> 'projectKey' is not null and config ->> 'issueTypeId' is not null)`;

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

const insertedIds = (result: { rows: unknown[] }) => (result.rows as { id: string }[]).map((r) => r.id);

// a product auditoria (manual or automatic): one row (and job) per distinct categoria of its products
export async function enqueueForProducts(tx: DrizzleDB, auditoriaId: string, produtoIds: string[]): Promise<void> {
  if (produtoIds.length === 0) return;
  const result = await tx.execute(sql`
    insert into auditoria_jira_issues (auditoria_id, categoria_id, categoria_nome)
    select distinct ${auditoriaId}::uuid, c.id, c.nome::text
    from produtos p join categorias c on c.id = p.categoria_id
    where p.id in (${idList(produtoIds)}) and ${JIRA_READY}
    on conflict (auditoria_id, categoria_id) do nothing
    returning id`);
  await enqueueJiraIssueJobs(tx, insertedIds(result));
}

// a categoria change: one row (and job) for that categoria, even when it has no products
export async function enqueueForCategoria(tx: DrizzleDB, auditoriaId: string, categoriaId: string): Promise<void> {
  const result = await tx.execute(sql`
    insert into auditoria_jira_issues (auditoria_id, categoria_id, categoria_nome)
    select ${auditoriaId}::uuid, c.id, c.nome::text from categorias c
    where c.id = ${categoriaId} and ${JIRA_READY}
    on conflict (auditoria_id, categoria_id) do nothing
    returning id`);
  await enqueueJiraIssueJobs(tx, insertedIds(result));
}

export type QueuedIssue = {
  id: string;
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
  produtos: string; // names of the auditoria's products in this categoria
  auditoriaRemovida: boolean;
};

export type IssueQueueEntry = {
  categoriaNome: string;
  status: "pendente" | "enviando" | "enviada" | "erro" | "cancelada";
  issueKey: string | null;
  issueUrl: string | null;
  tentativas: number;
  ultimoErro: string | null;
};

class JiraOutboxRepository {
  constructor(private readonly db: DrizzleDB) {}

  // The worker takes the row before calling Jira. Single statement: a job run twice (pg-boss retries
  // an expired job; a second run of the same row) only creates the issue once. null = nothing to do
  // (already sent, being sent within its lease, or cancelled).
  async claimForSend(id: string, leaseMinutes: number): Promise<QueuedIssue | null> {
    const { rows } = await this.db.execute(sql`
      with claimed as (
        update auditoria_jira_issues set status = 'enviando', tentativas = tentativas + 1,
          proxima_tentativa_em = now() + make_interval(mins => ${leaseMinutes})
        where id = ${id}
          and (status in ('pendente', 'erro') or (status = 'enviando' and proxima_tentativa_em < now()))
        returning *)
      select j.id, j.auditoria_id, j.categoria_nome, j.tentativas,
             a.acao_efetuada::text as acao, (extract(epoch from a.data_de_audicao) * 1000)::float8 as data_de_audicao,
             u.nome as auditor, d.nome_do_produto, d.valor_anterior::text as valor_anterior,
             d.valor_atual::text as valor_atual, d.observacoes_adicionais as observacoes,
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
      produtos: r.produtos,
      auditoriaRemovida: r.auditoria_removida,
    };
  }

  async markSent(id: string, issueKey: string, issueUrl: string): Promise<void> {
    await this.db.execute(sql`
      update auditoria_jira_issues set status = 'enviada', issue_key = ${issueKey}, issue_url = ${issueUrl},
        ultimo_erro = null, enviado_em = now()
      where id = ${id}`);
  }

  // retryInMs: roughly when pg-boss runs it again (shown on the pages); null = it gave up
  async markFailed(id: string, message: string, retryInMs: number | null): Promise<void> {
    await this.db.execute(sql`
      update auditoria_jira_issues set status = 'erro', ultimo_erro = ${message.slice(0, 1000)},
        proxima_tentativa_em = ${retryInMs === null ? sql`now()` : sql`now() + make_interval(secs => ${retryInMs / 1000})`}
      where id = ${id}`);
  }

  async markCancelled(id: string): Promise<void> {
    await this.db.execute(sql`update auditoria_jira_issues set status = 'cancelada' where id = ${id}`);
  }

  // rows that still need a job (saved while the queue wasn't running, or reset by "Reenviar")
  async listWithoutJob(limit: number): Promise<string[]> {
    const { rows } = await this.db.execute(sql`
      select id from auditoria_jira_issues where status = 'pendente' and job_id is null
      order by criado_em limit ${limit}`);
    return (rows as { id: string }[]).map((r) => r.id);
  }

  // gives the rows their jobs (on a transaction, so the job and job_id are saved together)
  async enqueueJobs(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let enqueued = 0;
    await this.db.transaction(async (tx: DrizzleDB) => {
      const { rows } = await tx.execute(sql`
        select id from auditoria_jira_issues
        where id in (${idList(ids)}) and status = 'pendente' and job_id is null
        for update skip locked`);
      const pending = (rows as { id: string }[]).map((r) => r.id);
      if (await enqueueJiraIssueJobs(tx, pending)) enqueued = pending.length;
    });
    return enqueued;
  }

  async listForAuditoria(auditoriaId: string): Promise<IssueQueueEntry[]> {
    const { rows } = await this.db.execute(sql`
      select categoria_nome, status, issue_key, issue_url, tentativas, ultimo_erro
      from auditoria_jira_issues where auditoria_id = ${auditoriaId} order by categoria_nome`);
    return (rows as any[]).map((r) => ({
      categoriaNome: r.categoria_nome,
      status: r.status,
      issueKey: r.issue_key,
      issueUrl: r.issue_url,
      tentativas: Number(r.tentativas),
      ultimoErro: r.ultimo_erro,
    }));
  }

  async summary(maxAttempts: number): Promise<{
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
      from auditoria_jira_issues`);
    const { rows: erros } = await this.db.execute(sql`
      select categoria_nome, auditoria_id, ultimo_erro, tentativas from auditoria_jira_issues
      where status = 'erro' order by proxima_tentativa_em desc limit 5`);
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

  // "Reenviar": rows that gave up start over without a job; JiraIssueWorker.enqueueMissing gives them one.
  // Rows still within their retries are left alone (pg-boss already has their next attempt scheduled).
  async resetExhausted(maxAttempts: number): Promise<string[]> {
    const { rows } = await this.db.execute(sql`
      update auditoria_jira_issues set status = 'pendente', tentativas = 0, job_id = null, proxima_tentativa_em = now()
      where status = 'erro' and tentativas >= ${maxAttempts}
      returning id`);
    return (rows as { id: string }[]).map((r) => r.id);
  }
}

export default JiraOutboxRepository;
