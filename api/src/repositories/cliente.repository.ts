import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// clientes and empresas (drizzle/0016_clientes.sql, 0017_empresas.sql): the local copy of the HubSpot
// contacts and companies

export type ClienteHubspot = {
  hubspotId: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  estagio: string | null;
  url: string | null;
  criadoEm: string | null;
  atualizadoEm: string | null;
  cargo: string | null;
  senioridade: string | null;
  papeis: string[];
  empresasHubspotIds: string[];
};

export type EmpresaHubspot = { hubspotId: string; nome: string; dominio: string | null; setor: string | null; url: string | null };

export type ClienteDto = {
  id: string;
  hubspot_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  estagio: string | null;
  url: string | null;
  cargo: string | null;
  senioridade: string | null;
  papeis: string[];
};

export type ContatoRanqueadoDto = Omit<ClienteDto, "hubspot_id" | "telefone" | "empresa" | "estagio"> & {
  posicao: number; // rank within the company, from 1
};

export type EmpresaDto = {
  id: string;
  nome: string;
  dominio: string | null;
  setor: string | null;
  url: string | null;
  total_contatos: number;
  total_decisores: number;
  contatos: ContatoRanqueadoDto[]; // the top of the rank, at most CONTATOS_POR_EMPRESA
};

const CONTATOS_POR_EMPRESA = 25;
const DECISOR = "DECISION_MAKER";
// hs_seniority's values, highest first
const SENIORIDADES = ["owner", "partner", "executive", "vp", "director", "manager", "senior", "employee", "entry"];

// the rank within a company: decision makers, then seniority, then name
const RANK = sql`${DECISOR} = any(c.papeis) desc, coalesce(array_position(${sql.param(SENIORIDADES)}::text[], c.senioridade), 99), lower(c.nome), c.id`;

const coluna = <T>(items: T[], valor: (item: T) => string | null) => sql.param(items.map(valor));
// unnest flattens arrays of arrays, so a list per row travels as one string
const lista = <T>(items: T[], valor: (item: T) => string[]) => sql.param(items.map((item) => valor(item).join(";")));

const padraoDeBusca = (busca: string) => `%${busca.replace(/[\\%_]/g, "\\$&")}%`;

class ClienteRepository {
  constructor(private readonly db: DrizzleDB) {}

  // the database's clock, so a sync's rows can be told from older ones
  async agora(): Promise<string> {
    const { rows } = await this.db.execute(sql`select now()::text as agora`);
    return (rows[0] as { agora: string }).agora;
  }

  async salvar(clientes: ClienteHubspot[]): Promise<void> {
    if (clientes.length === 0) return;
    await this.db.execute(sql`
      insert into clientes (hubspot_id, nome, email, telefone, empresa, estagio, url, criado_no_hubspot_em,
        atualizado_no_hubspot_em, cargo, senioridade, papeis, empresas_hubspot_ids)
      select hubspot_id, nome, email, telefone, empresa, estagio, url, criado, atualizado, cargo, senioridade,
        string_to_array(papeis, ';'), string_to_array(empresas, ';')
      from unnest(
        ${coluna(clientes, (c) => c.hubspotId)}::text[], ${coluna(clientes, (c) => c.nome)}::text[],
        ${coluna(clientes, (c) => c.email)}::text[], ${coluna(clientes, (c) => c.telefone)}::text[],
        ${coluna(clientes, (c) => c.empresa)}::text[], ${coluna(clientes, (c) => c.estagio)}::text[],
        ${coluna(clientes, (c) => c.url)}::text[], ${coluna(clientes, (c) => c.criadoEm)}::timestamptz[],
        ${coluna(clientes, (c) => c.atualizadoEm)}::timestamptz[], ${coluna(clientes, (c) => c.cargo)}::text[],
        ${coluna(clientes, (c) => c.senioridade)}::text[], ${lista(clientes, (c) => c.papeis)}::text[],
        ${lista(clientes, (c) => c.empresasHubspotIds)}::text[]
      ) as v(hubspot_id, nome, email, telefone, empresa, estagio, url, criado, atualizado, cargo, senioridade, papeis, empresas)
      on conflict (hubspot_id) do update set
        nome = excluded.nome, email = excluded.email, telefone = excluded.telefone, empresa = excluded.empresa,
        estagio = excluded.estagio, url = excluded.url, criado_no_hubspot_em = excluded.criado_no_hubspot_em,
        atualizado_no_hubspot_em = excluded.atualizado_no_hubspot_em, cargo = excluded.cargo,
        senioridade = excluded.senioridade, papeis = excluded.papeis,
        empresas_hubspot_ids = excluded.empresas_hubspot_ids, sincronizado_em = now()`);
  }

  async salvarEmpresas(empresas: EmpresaHubspot[]): Promise<void> {
    if (empresas.length === 0) return;
    await this.db.execute(sql`
      insert into empresas (hubspot_id, nome, dominio, setor, url)
      select * from unnest(
        ${coluna(empresas, (e) => e.hubspotId)}::text[], ${coluna(empresas, (e) => e.nome)}::text[],
        ${coluna(empresas, (e) => e.dominio)}::text[], ${coluna(empresas, (e) => e.setor)}::text[],
        ${coluna(empresas, (e) => e.url)}::text[]
      )
      on conflict (hubspot_id) do update set
        nome = excluded.nome, dominio = excluded.dominio, setor = excluded.setor, url = excluded.url, sincronizado_em = now()`);
  }

  // after a complete sync: whatever it didn't see no longer exists in HubSpot
  async removerAusentes(desde: string): Promise<number> {
    const clientes = await this.db.execute(sql`delete from clientes where sincronizado_em < ${desde}::timestamptz`);
    const empresas = await this.db.execute(sql`delete from empresas where sincronizado_em < ${desde}::timestamptz`);
    return (clientes.rowCount ?? 0) + (empresas.rowCount ?? 0);
  }

  // Companies with their contacts ranked. One query for the page and one for the contacts of its
  // companies, so the count of companies never multiplies into a query per company.
  async listarEmpresas(page: number, amount: number, busca: string, soDecisores: boolean) {
    const termo = padraoDeBusca(busca);
    const condicoes = [
      ...(busca
        ? [sql`(e.nome ilike ${termo} or e.dominio ilike ${termo} or exists (
            select 1 from clientes c where c.empresas_hubspot_ids @> array[e.hubspot_id] and c.nome ilike ${termo}))`]
        : []),
      ...(soDecisores
        ? [sql`exists (select 1 from clientes c where c.empresas_hubspot_ids @> array[e.hubspot_id] and ${DECISOR} = any(c.papeis))`]
        : []),
    ];
    const filtro = condicoes.length > 0 ? sql`where ${sql.join(condicoes, sql` and `)}` : sql``;

    const { rows: empresas } = await this.db.execute(sql`
      select e.id, e.nome, e.dominio, e.setor, e.url,
        (select count(*)::int from clientes c where c.empresas_hubspot_ids @> array[e.hubspot_id]) as total_contatos,
        (select count(*)::int from clientes c where c.empresas_hubspot_ids @> array[e.hubspot_id] and ${DECISOR} = any(c.papeis)) as total_decisores
      from empresas e ${filtro}
      order by lower(e.nome), e.id limit ${amount} offset ${(page - 1) * amount}`);
    const { rows: totais } = await this.db.execute(sql`
      select (select count(*)::int from empresas e ${filtro}) as total,
        (select count(*)::int from clientes where cardinality(empresas_hubspot_ids) = 0) as sem_empresa`);

    const ids = (empresas as { id: string }[]).map((e) => e.id);
    const { rows: contatos } = ids.length === 0
      ? { rows: [] }
      : await this.db.execute(sql`
          select * from (
            select e.id as empresa_id, c.id, c.nome, c.email, c.url, c.cargo, c.senioridade, c.papeis,
              row_number() over (partition by e.id order by ${RANK})::int as posicao
            from empresas e join clientes c on c.empresas_hubspot_ids @> array[e.hubspot_id]
            where e.id = any(${sql.param(ids)}::uuid[])
          ) ranqueados
          where posicao <= ${CONTATOS_POR_EMPRESA} ${soDecisores ? sql`and ${DECISOR} = any(papeis)` : sql``}
          order by posicao`);

    const porEmpresa = new Map<string, ContatoRanqueadoDto[]>();
    for (const { empresa_id, ...contato } of contatos as (ContatoRanqueadoDto & { empresa_id: string })[]) {
      porEmpresa.set(empresa_id, [...(porEmpresa.get(empresa_id) ?? []), contato]);
    }
    const { total, sem_empresa } = totais[0] as { total: number; sem_empresa: number };
    return {
      data: (empresas as Omit<EmpresaDto, "contatos">[]).map((e) => ({ ...e, contatos: porEmpresa.get(e.id) ?? [] })),
      totalItems: total,
      semEmpresa: sem_empresa,
    };
  }

  async listar(page: number, amount: number, busca: string): Promise<{ data: ClienteDto[]; totalItems: number; sincronizadoEm: string | null }> {
    const termo = padraoDeBusca(busca);
    const filtro = busca ? sql`where nome ilike ${termo} or email ilike ${termo} or empresa ilike ${termo}` : sql``;
    const { rows } = await this.db.execute(sql`
      select id, hubspot_id, nome, email, telefone, empresa, estagio, url, cargo, senioridade, papeis from clientes ${filtro}
      order by lower(nome), id limit ${amount} offset ${(page - 1) * amount}`);
    const { rows: totais } = await this.db.execute(sql`
      select count(*)::int as total, (select max(sincronizado_em) from clientes)::text as sincronizado_em from clientes ${filtro}`);
    const { total, sincronizado_em } = totais[0] as { total: number; sincronizado_em: string | null };
    return { data: rows as ClienteDto[], totalItems: total, sincronizadoEm: sincronizado_em };
  }
}

export default ClienteRepository;
