import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// Transactional outbox of Jira issues for new auditorias (drizzle/0006, 0007): one row per
// (auditoria, categoria it touches), written on the auditoria's own transaction, so none is lost.
// JiraIssueRelay publishes the rows to Kafka; JiraIssueConsumer creates the issues and records the
// outcome here, which is also what the pages show.
//
//   pendente -> publicada (relay) -> enviando (consumer) -> enviada
//                                                        -> erro (retried through the Kafka retry topics)
//                                                        -> cancelada (auditoria removed)
// publicada/enviando carry a deadline in proxima_tentativa_em; a row past it (a process died mid-way,
// or a message was lost) is published again by the relay.

// only while Jira is connected and has a project and issue type chosen; otherwise nothing is queued,
// so auditorias made before connecting don't all land in Jira at once later
const JIRA_READY = sql`exists (
  select 1 from integracoes
  where provider = 'jira' and config ->> 'projectKey' is not null and config ->> 'issueTypeId' is not null)`;

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

// a product auditoria (manual or automatic): one row per distinct categoria of its products
export async function enqueueForProducts(tx: DrizzleDB, auditoriaId: string, produtoIds: string[]): Promise<void> {
  if (produtoIds.length === 0) return;
  await tx.execute(sql`
    insert into auditoria_jira_issues (auditoria_id, categoria_id, categoria_nome)
    select distinct ${auditoriaId}::uuid, c.id, c.nome::text
    from produtos p join categorias c on c.id = p.categoria_id
    where p.id in (${idList(produtoIds)}) and ${JIRA_READY}
    on conflict (auditoria_id, categoria_id) do nothing`);
}

// a categoria change: one row for that categoria, even when it has no products
export async function enqueueForCategoria(tx: DrizzleDB, auditoriaId: string, categoriaId: string): Promise<void> {
  await tx.execute(sql`
    insert into auditoria_jira_issues (auditoria_id, categoria_id, categoria_nome)
    select ${auditoriaId}::uuid, c.id, c.nome::text from categorias c
    where c.id = ${categoriaId} and ${JIRA_READY}
    on conflict (auditoria_id, categoria_id) do nothing`);
}

// what the relay puts on the topic: just the outbox row; the consumer reads the rest from the database
export type OutboxMessage = { outboxId: string; auditoriaId: string; categoriaNome: string };

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
  status: "pendente" | "publicada" | "enviando" | "enviada" | "erro" | "cancelada";
  issueKey: string | null;
  issueUrl: string | null;
  tentativas: number;
  ultimoErro: string | null;
};

class JiraOutboxRepository {
  constructor(private readonly db: DrizzleDB) {}

  // Rows to put on Kafka: new ones, and any publicada/enviando/erro row whose deadline passed (its
  // message or its consumer was lost). They become 'publicada' for `publishWindowMinutes`; SKIP LOCKED
  // keeps two relays (two API instances) from taking the same rows.
  async claimForPublish(limit: number, maxAttempts: number, publishWindowMinutes: number): Promise<OutboxMessage[]> {
    const { rows } = await this.db.execute(sql`
      update auditoria_jira_issues set status = 'publicada',
        proxima_tentativa_em = now() + make_interval(mins => ${publishWindowMinutes})
      where id in (
        select id from auditoria_jira_issues
        where status = 'pendente'
           or (status in ('publicada', 'enviando') and proxima_tentativa_em < now())
           or (status = 'erro' and tentativas < ${maxAttempts} and proxima_tentativa_em < now() - interval '10 minutes')
        order by criado_em
        limit ${limit}
        for update skip locked)
      returning id, auditoria_id, categoria_nome`);
    return (rows as any[]).map((r) => ({ outboxId: r.id, auditoriaId: r.auditoria_id, categoriaNome: r.categoria_nome }));
  }

  // the relay couldn't reach Kafka: back to 'pendente' so the next tick tries again
  async releaseUnpublished(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(sql`
      update auditoria_jira_issues set status = 'pendente', proxima_tentativa_em = now()
      where id in (${idList(ids)}) and status = 'publicada'`);
  }

  // The consumer takes one row to send it. Single statement: a message delivered twice (Kafka is
  // at-least-once) or handled by two consumers only creates the issue once. null = nothing to do
  // (already sent, being sent within its lease, or cancelled).
  async claimForSend(id: string, leaseMinutes: number): Promise<QueuedIssue | null> {
    const { rows } = await this.db.execute(sql`
      with claimed as (
        update auditoria_jira_issues set status = 'enviando', tentativas = tentativas + 1,
          proxima_tentativa_em = now() + make_interval(mins => ${leaseMinutes})
        where id = ${id}
          and (status in ('pendente', 'publicada', 'erro') or (status = 'enviando' and proxima_tentativa_em < now()))
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

  // retryInMs: when the retry topic will deliver it again (shown on the pages; past it plus a grace
  // period, the relay republishes it in case the retry message was lost); null = gave up
  async markFailed(id: string, message: string, retryInMs: number | null): Promise<void> {
    await this.db.execute(sql`
      update auditoria_jira_issues set status = 'erro', ultimo_erro = ${message.slice(0, 1000)},
        proxima_tentativa_em = ${retryInMs === null ? sql`now()` : sql`now() + make_interval(secs => ${retryInMs / 1000})`}
      where id = ${id}`);
  }

  async markCancelled(id: string): Promise<void> {
    await this.db.execute(sql`update auditoria_jira_issues set status = 'cancelada' where id = ${id}`);
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
    esgotadas: number; // gave up after maxAttempts (also on the dead-letter topic); only "Reenviar" brings them back
    erros: { categoriaNome: string; auditoriaId: string; ultimoErro: string | null; tentativas: number }[];
  }> {
    const { rows } = await this.db.execute(sql`
      select
        count(*) filter (where status = 'enviada')::int as enviadas,
        count(*) filter (where status in ('pendente', 'publicada', 'enviando'))::int as pendentes,
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

  // "Reenviar": failed rows (including the ones that gave up) start over and the relay publishes them
  async retryFailed(): Promise<number> {
    const { rowCount } = await this.db.execute(sql`
      update auditoria_jira_issues set status = 'pendente', tentativas = 0, proxima_tentativa_em = now()
      where status = 'erro'`);
    return rowCount ?? 0;
  }
}

export default JiraOutboxRepository;
