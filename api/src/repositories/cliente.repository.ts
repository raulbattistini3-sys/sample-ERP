import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// clientes (drizzle/0016_clientes.sql): the local copy of the HubSpot contacts

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
};

export type ClienteDto = {
  id: string;
  hubspot_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  estagio: string | null;
  url: string | null;
};

const coluna = <T>(items: T[], valor: (item: T) => string | null) => sql.param(items.map(valor));

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
      insert into clientes (hubspot_id, nome, email, telefone, empresa, estagio, url, criado_no_hubspot_em, atualizado_no_hubspot_em)
      select * from unnest(
        ${coluna(clientes, (c) => c.hubspotId)}::text[], ${coluna(clientes, (c) => c.nome)}::text[],
        ${coluna(clientes, (c) => c.email)}::text[], ${coluna(clientes, (c) => c.telefone)}::text[],
        ${coluna(clientes, (c) => c.empresa)}::text[], ${coluna(clientes, (c) => c.estagio)}::text[],
        ${coluna(clientes, (c) => c.url)}::text[], ${coluna(clientes, (c) => c.criadoEm)}::timestamptz[],
        ${coluna(clientes, (c) => c.atualizadoEm)}::timestamptz[]
      )
      on conflict (hubspot_id) do update set
        nome = excluded.nome, email = excluded.email, telefone = excluded.telefone, empresa = excluded.empresa,
        estagio = excluded.estagio, url = excluded.url, criado_no_hubspot_em = excluded.criado_no_hubspot_em,
        atualizado_no_hubspot_em = excluded.atualizado_no_hubspot_em, sincronizado_em = now()`);
  }

  // after a complete sync: whatever it didn't see no longer exists in HubSpot
  async removerAusentes(desde: string): Promise<number> {
    const { rowCount } = await this.db.execute(sql`delete from clientes where sincronizado_em < ${desde}::timestamptz`);
    return rowCount ?? 0;
  }

  async listar(page: number, amount: number, busca: string): Promise<{ data: ClienteDto[]; totalItems: number; sincronizadoEm: string | null }> {
    const termo = `%${busca.replace(/[\\%_]/g, "\\$&")}%`;
    const filtro = busca ? sql`where nome ilike ${termo} or email ilike ${termo} or empresa ilike ${termo}` : sql``;
    const { rows } = await this.db.execute(sql`
      select id, hubspot_id, nome, email, telefone, empresa, estagio, url from clientes ${filtro}
      order by lower(nome), id limit ${amount} offset ${(page - 1) * amount}`);
    const { rows: totais } = await this.db.execute(sql`
      select count(*)::int as total, (select max(sincronizado_em) from clientes)::text as sincronizado_em from clientes ${filtro}`);
    const { total, sincronizado_em } = totais[0] as { total: number; sincronizado_em: string | null };
    return { data: rows as ClienteDto[], totalItems: total, sincronizadoEm: sincronizado_em };
  }
}

export default ClienteRepository;
