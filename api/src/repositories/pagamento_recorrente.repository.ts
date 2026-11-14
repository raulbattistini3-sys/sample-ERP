import { sql, SQL } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// pagamentos_recorrentes and pagamento_recorrente_ciclos (drizzle/0022_clientes_erp.sql). Dates are
// computed here, in Postgres, on the São Paulo calendar: a date plus 'n months' clamps to the last day
// of a shorter month (Jan 31 + 1 month = Feb 28), and each cycle's date comes from data_inicio, so a
// clamped month doesn't drift the ones after it. Every statement stands alone (the pooler shares
// sessions, nothing is SET).

export type StatusPlano = "ativo" | "pausado" | "encerrado" | "cancelado";
export type Unidade = "dias" | "meses";

export type PagamentoRecorrente = {
  id: string;
  hubspotContatoId: string;
  descricao: string;
  valorCentavos: number;
  valorMaximoCentavos: number;
  valorMinimoCentavos: number | null;
  intervalo: number;
  unidade: Unidade;
  vencimentoDias: number;
  dataInicio: string;
  dataFim: string | null;
  cc: string[]; // copies of each cycle's e-mail
  cco: string[]; // blind copies
  proximoCiclo: number;
  proximaData: string;
  status: StatusPlano;
  tentativas: number;
  ultimoErro: string | null;
  criadoPorNome: string;
  criadoPorEmail: string;
  criadoEm: string;
  atualizadoEm: string;
};

export type CicloRegistrado = {
  ciclo: number;
  dataReferencia: string;
  valorCentavos: number;
  status: "emitida" | "falhou" | "pulado";
  faturaId: string | null;
  faturaNumero: string | null;
  faturaUrl: string | null;
  vencimento: string | null;
  emailEnviado: boolean;
  erro: string | null;
  criadoEm: string;
};

export type NovoPlano = {
  hubspotContatoId: string;
  descricao: string;
  valorCentavos: number;
  valorMaximoCentavos: number;
  valorMinimoCentavos: number | null;
  intervalo: number;
  unidade: Unidade;
  vencimentoDias: number;
  dataInicio: string;
  dataFim: string | null;
  cc: string[];
  cco: string[];
  criadoPor: string;
  criadoPorNome: string;
  criadoPorEmail: string;
};

export type Alteracao = Partial<Pick<PagamentoRecorrente, "descricao" | "valorCentavos" | "valorMaximoCentavos" | "valorMinimoCentavos" | "vencimentoDias" | "dataFim" | "cc" | "cco">>;

const HOJE = sql`(now() at time zone 'America/Sao_Paulo')::date`;

// the date of cycle n of a row, as SQL
const dataDoCiclo = (n: SQL) =>
  sql`(data_inicio + (${n} * intervalo) * (case when unidade = 'meses' then interval '1 month' else interval '1 day' end))::date`;

const COLUNAS = sql`
  id, hubspot_contato_id, descricao, valor_centavos, valor_maximo_centavos, valor_minimo_centavos, intervalo, unidade,
  vencimento_dias, to_char(data_inicio, 'YYYY-MM-DD') as data_inicio, to_char(data_fim, 'YYYY-MM-DD') as data_fim, cc, cco,
  proximo_ciclo, to_char(proxima_data, 'YYYY-MM-DD') as proxima_data, status, tentativas, ultimo_erro,
  criado_por_nome, criado_por_email, criado_em, atualizado_em`;

type Linha = Record<string, unknown>;

const toPlano = (r: Linha): PagamentoRecorrente => ({
  id: String(r.id),
  hubspotContatoId: String(r.hubspot_contato_id),
  descricao: String(r.descricao),
  valorCentavos: Number(r.valor_centavos),
  valorMaximoCentavos: Number(r.valor_maximo_centavos),
  valorMinimoCentavos: r.valor_minimo_centavos === null ? null : Number(r.valor_minimo_centavos),
  intervalo: Number(r.intervalo),
  unidade: r.unidade as Unidade,
  vencimentoDias: Number(r.vencimento_dias),
  dataInicio: String(r.data_inicio),
  dataFim: (r.data_fim as string | null) ?? null,
  cc: (r.cc as string[] | null) ?? [],
  cco: (r.cco as string[] | null) ?? [],
  proximoCiclo: Number(r.proximo_ciclo),
  proximaData: String(r.proxima_data),
  status: r.status as StatusPlano,
  tentativas: Number(r.tentativas),
  ultimoErro: (r.ultimo_erro as string | null) ?? null,
  criadoPorNome: String(r.criado_por_nome),
  criadoPorEmail: String(r.criado_por_email),
  criadoEm: new Date(r.criado_em as string).toISOString(),
  atualizadoEm: new Date(r.atualizado_em as string).toISOString(),
});

const toCiclo = (r: Linha): CicloRegistrado => ({
  ciclo: Number(r.ciclo),
  dataReferencia: String(r.data_referencia),
  valorCentavos: Number(r.valor_centavos),
  status: r.status as CicloRegistrado["status"],
  faturaId: (r.fatura_id as string | null) ?? null,
  faturaNumero: (r.fatura_numero as string | null) ?? null,
  faturaUrl: (r.fatura_url as string | null) ?? null,
  vencimento: (r.vencimento as string | null) ?? null,
  emailEnviado: Boolean(r.email_enviado),
  erro: (r.erro as string | null) ?? null,
  criadoEm: new Date(r.criado_em as string).toISOString(),
});

class PagamentoRecorrenteRepository {
  constructor(private readonly db: DrizzleDB) {}

  async hoje(): Promise<string> {
    const { rows } = await this.db.execute(sql`select to_char(${HOJE}, 'YYYY-MM-DD') as hoje`);
    return String((rows as Linha[])[0].hoje);
  }

  async criar(p: NovoPlano): Promise<PagamentoRecorrente> {
    const { rows } = await this.db.execute(sql`
      insert into pagamentos_recorrentes (
        hubspot_contato_id, descricao, valor_centavos, valor_maximo_centavos, valor_minimo_centavos, intervalo, unidade,
        vencimento_dias, data_inicio, data_fim, cc, cco, proxima_data, criado_por, criado_por_nome, criado_por_email)
      values (
        ${p.hubspotContatoId}, ${p.descricao}, ${p.valorCentavos}, ${p.valorMaximoCentavos}, ${p.valorMinimoCentavos}, ${p.intervalo},
        ${p.unidade}, ${p.vencimentoDias}, ${p.dataInicio}::date, ${p.dataFim}::date, ${p.cc}::text[], ${p.cco}::text[], ${p.dataInicio}::date, ${p.criadoPor},
        ${p.criadoPorNome}, ${p.criadoPorEmail})
      returning ${COLUNAS}`);
    return toPlano((rows as Linha[])[0]);
  }

  async obter(id: string): Promise<PagamentoRecorrente | null> {
    const { rows } = await this.db.execute(sql`select ${COLUNAS} from pagamentos_recorrentes where id = ${id}::uuid`);
    const r = (rows as Linha[])[0];
    return r ? toPlano(r) : null;
  }

  async listar(contatoId: string | null): Promise<PagamentoRecorrente[]> {
    const filtro = contatoId ? sql`where hubspot_contato_id = ${contatoId}` : sql``;
    const { rows } = await this.db.execute(sql`
      select ${COLUNAS} from pagamentos_recorrentes ${filtro}
      order by (status in ('ativo', 'pausado')) desc, proxima_data, criado_em desc
      limit 200`);
    return (rows as Linha[]).map(toPlano);
  }

  async ciclos(pagamentoId: string, limite = 24): Promise<CicloRegistrado[]> {
    const { rows } = await this.db.execute(sql`
      select ciclo, to_char(data_referencia, 'YYYY-MM-DD') as data_referencia, valor_centavos, status, fatura_id, fatura_numero,
             fatura_url, vencimento, email_enviado, erro, criado_em
      from pagamento_recorrente_ciclos where pagamento_id = ${pagamentoId}::uuid
      order by ciclo desc limit ${limite}`);
    return (rows as Linha[]).map(toCiclo);
  }

  // values and end date; the check constraints guard min ≤ valor ≤ max
  async alterar(id: string, a: Alteracao): Promise<PagamentoRecorrente | null> {
    const sets: SQL[] = [];
    if (a.descricao !== undefined) sets.push(sql`descricao = ${a.descricao}`);
    if (a.valorCentavos !== undefined) sets.push(sql`valor_centavos = ${a.valorCentavos}`);
    if (a.valorMaximoCentavos !== undefined) sets.push(sql`valor_maximo_centavos = ${a.valorMaximoCentavos}`);
    if (a.valorMinimoCentavos !== undefined) sets.push(sql`valor_minimo_centavos = ${a.valorMinimoCentavos}`);
    if (a.vencimentoDias !== undefined) sets.push(sql`vencimento_dias = ${a.vencimentoDias}`);
    if (a.dataFim !== undefined) sets.push(sql`data_fim = ${a.dataFim}::date`);
    if (a.cc !== undefined) sets.push(sql`cc = ${a.cc}::text[]`);
    if (a.cco !== undefined) sets.push(sql`cco = ${a.cco}::text[]`);
    sets.push(sql`atualizado_em = now()`);
    const { rows } = await this.db.execute(sql`
      update pagamentos_recorrentes set ${sql.join(sets, sql`, `)}
      where id = ${id}::uuid and status in ('ativo', 'pausado')
      returning ${COLUNAS}`);
    const r = (rows as Linha[])[0];
    return r ? toPlano(r) : null;
  }

  async pausar(id: string): Promise<PagamentoRecorrente | null> {
    return this.mudarStatus(id, "pausado", sql`status = 'ativo'`, sql``);
  }

  // resuming doesn't charge the cycles that passed while paused: it moves to the first cycle from today on
  async retomar(id: string): Promise<PagamentoRecorrente | null> {
    const proximo = sql`(
      select min(n)::int from generate_series(proximo_ciclo, proximo_ciclo + 5000) as n where ${dataDoCiclo(sql`n`)} >= ${HOJE})`;
    return this.mudarStatus(
      id,
      "ativo",
      sql`status = 'pausado'`,
      sql`, proximo_ciclo = ${proximo}, proxima_data = ${dataDoCiclo(proximo)}, tentativas = 0, bloqueado_ate = null, ultimo_erro = null`,
    );
  }

  async cancelar(id: string): Promise<PagamentoRecorrente | null> {
    return this.mudarStatus(id, "cancelado", sql`status in ('ativo', 'pausado')`, sql``);
  }

  private async mudarStatus(id: string, status: StatusPlano, de: SQL, extra: SQL): Promise<PagamentoRecorrente | null> {
    const { rows } = await this.db.execute(sql`
      update pagamentos_recorrentes set status = ${status}, atualizado_em = now() ${extra}
      where id = ${id}::uuid and ${de}
      returning ${COLUNAS}`);
    const r = (rows as Linha[])[0];
    return r ? toPlano(r) : null;
  }

  // Takes up to `limite` active plans due today or earlier and leases them for `leaseMinutos`, in one
  // statement, so two API instances never work the same plan at once.
  async reservarDevidos(limite: number, leaseMinutos: number): Promise<PagamentoRecorrente[]> {
    const { rows } = await this.db.execute(sql`
      update pagamentos_recorrentes set bloqueado_ate = now() + make_interval(mins => ${leaseMinutos})
      where id in (
        select id from pagamentos_recorrentes
        where status = 'ativo' and proxima_data <= ${HOJE} and (bloqueado_ate is null or bloqueado_ate < now())
        order by proxima_data
        limit ${limite}
        for update skip locked)
      returning ${COLUNAS}`);
    return (rows as Linha[]).map(toPlano);
  }

  // Cycles whose date is before today (the API was down on their day) are written as 'pulado' and the
  // plan moves to the first cycle dated today or later. Returns the plan as it stands afterwards.
  async pularAtrasados(id: string): Promise<PagamentoRecorrente | null> {
    await this.db.execute(sql`
      insert into pagamento_recorrente_ciclos (pagamento_id, ciclo, data_referencia, valor_centavos, status, erro)
      select p.id, n, ${dataDoCiclo(sql`n`)}, p.valor_centavos, 'pulado', 'a data passou sem que a cobrança fosse emitida (API fora do ar)'
      from pagamentos_recorrentes p, generate_series(p.proximo_ciclo, p.proximo_ciclo + 5000) as n
      where p.id = ${id}::uuid and ${dataDoCiclo(sql`n`)} < ${HOJE}
        and (p.data_fim is null or ${dataDoCiclo(sql`n`)} <= p.data_fim)
      on conflict (pagamento_id, ciclo) do nothing`);
    const proximo = sql`(
      select min(n)::int from generate_series(proximo_ciclo, proximo_ciclo + 5000) as n where ${dataDoCiclo(sql`n`)} >= ${HOJE})`;
    const { rows } = await this.db.execute(sql`
      update pagamentos_recorrentes set proximo_ciclo = ${proximo}, proxima_data = ${dataDoCiclo(proximo)}, atualizado_em = now()
      where id = ${id}::uuid and proxima_data < ${HOJE}
      returning ${COLUNAS}`);
    await this.encerrarSeTerminou(id);
    const r = (rows as Linha[])[0];
    return r ? toPlano(r) : this.obter(id);
  }

  // Records a cycle's outcome and moves the plan to the next one (or ends it past data_fim). The insert
  // is first: if the cycle already has a row, nothing else changes.
  async concluirCiclo(plano: PagamentoRecorrente, ciclo: Omit<CicloRegistrado, "criadoEm" | "ciclo" | "dataReferencia">): Promise<void> {
    const { rows } = await this.db.execute(sql`
      insert into pagamento_recorrente_ciclos (
        pagamento_id, ciclo, data_referencia, valor_centavos, status, fatura_id, fatura_numero, fatura_url, vencimento, email_enviado, erro)
      values (
        ${plano.id}::uuid, ${plano.proximoCiclo}, ${plano.proximaData}::date, ${ciclo.valorCentavos}, ${ciclo.status}, ${ciclo.faturaId},
        ${ciclo.faturaNumero}, ${ciclo.faturaUrl}, ${ciclo.vencimento}, ${ciclo.emailEnviado}, ${ciclo.erro})
      on conflict (pagamento_id, ciclo) do nothing
      returning ciclo`);
    if ((rows as Linha[]).length === 0) return;
    await this.db.execute(sql`
      update pagamentos_recorrentes
      set proximo_ciclo = proximo_ciclo + 1, proxima_data = ${dataDoCiclo(sql`(proximo_ciclo + 1)`)}, tentativas = 0,
          bloqueado_ate = null, ultimo_erro = ${ciclo.status === "falhou" ? ciclo.erro : null}, atualizado_em = now()
      where id = ${plano.id}::uuid and proximo_ciclo = ${plano.proximoCiclo}`);
    await this.encerrarSeTerminou(plano.id);
  }

  // a failed attempt that will be retried: the lease becomes the backoff
  async adiar(id: string, erro: string, esperaMinutos: number): Promise<void> {
    await this.db.execute(sql`
      update pagamentos_recorrentes
      set tentativas = tentativas + 1, ultimo_erro = ${erro}, bloqueado_ate = now() + make_interval(mins => ${esperaMinutos}), atualizado_em = now()
      where id = ${id}::uuid`);
  }

  async liberar(id: string): Promise<void> {
    await this.db.execute(sql`update pagamentos_recorrentes set bloqueado_ate = null where id = ${id}::uuid`);
  }

  private async encerrarSeTerminou(id: string): Promise<void> {
    await this.db.execute(sql`
      update pagamentos_recorrentes set status = 'encerrado', atualizado_em = now()
      where id = ${id}::uuid and status = 'ativo' and data_fim is not null and proxima_data > data_fim`);
  }
}

export default PagamentoRecorrenteRepository;
