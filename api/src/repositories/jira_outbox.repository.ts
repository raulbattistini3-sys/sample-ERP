import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// Queue of Jira issues for new auditorias (drizzle/0006_auditoria_jira_issues.sql): one row per
// (auditoria, categoria it touches). Enqueued on the auditoria's own transaction; sent later by
// JiraIssueDispatcher.

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
  status: "pendente" | "enviada" | "erro" | "cancelada";
  issueKey: string | null;
  issueUrl: string | null;
  tentativas: number;
  ultimoErro: string | null;
};

class JiraOutboxRepository {
  constructor(private readonly db: DrizzleDB) {}

  // Takes up to `limit` due rows and leases them for `leaseMinutes` (proxima_tentativa_em moves ahead,
  // tentativas + 1) in one statement with SKIP LOCKED: concurrent dispatchers, even in other API
  // instances, never get the same row. A dispatcher that dies mid-send frees its rows when the lease ends.
  async claimDue(limit: number, maxAttempts: number, leaseMinutes: number): Promise<QueuedIssue[]> {
    const { rows } = await this.db.execute(sql`
      with claimed as (
        update auditoria_jira_issues set
          tentativas = tentativas + 1,
          proxima_tentativa_em = now() + make_interval(mins => ${leaseMinutes})
        where id in (
          select id from auditoria_jira_issues
          where status in ('pendente', 'erro') and proxima_tentativa_em <= now() and tentativas < ${maxAttempts}
          order by criado_em
          limit ${limit}
          for update skip locked)
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
      left join usuarios u on u.id = a.usuario_id
      order by j.criado_em`);
    return (rows as any[]).map((r) => ({
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
    }));
  }

  async markSent(id: string, issueKey: string, issueUrl: string): Promise<void> {
    await this.db.execute(sql`
      update auditoria_jira_issues set status = 'enviada', issue_key = ${issueKey}, issue_url = ${issueUrl},
        ultimo_erro = null, enviado_em = now()
      where id = ${id}`);
  }

  async markFailed(id: string, message: string, retryInSeconds: number): Promise<void> {
    await this.db.execute(sql`
      update auditoria_jira_issues set status = 'erro', ultimo_erro = ${message.slice(0, 1000)},
        proxima_tentativa_em = now() + make_interval(secs => ${retryInSeconds})
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
    esgotadas: number; // gave up after maxAttempts; only "Reenviar" brings them back
    erros: { categoriaNome: string; auditoriaId: string; ultimoErro: string | null; tentativas: number }[];
  }> {
    const { rows } = await this.db.execute(sql`
      select
        count(*) filter (where status = 'enviada')::int as enviadas,
        count(*) filter (where status = 'pendente')::int as pendentes,
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

  // "Reenviar": failed rows (including the ones that gave up) are tried again right away
  async retryFailed(): Promise<number> {
    const { rowCount } = await this.db.execute(sql`
      update auditoria_jira_issues set tentativas = 0, proxima_tentativa_em = now()
      where status = 'erro'`);
    return rowCount ?? 0;
  }
}

export default JiraOutboxRepository;
