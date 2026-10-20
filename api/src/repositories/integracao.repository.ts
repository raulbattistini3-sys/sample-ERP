import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { Provider } from "../configs/oauth.providers";

// integracoes / oauth_estados (drizzle/0005_integracoes.sql), with parameterized SQL: timestamps
// come back as epoch milliseconds and jsonb as text, so nothing depends on driver type parsing

export type IntegracaoRow = {
  id: string;
  provider: Provider;
  accessTokenCifrado: string;
  refreshTokenCifrado: string | null;
  expiraEm: number | null; // epoch ms
  escopos: string;
  contaExterna: Record<string, unknown>;
  config: Record<string, unknown>;
  conectadoPor: string | null;
  conectadoPorNome: string | null;
  conectadoEm: number;
};

export type TokenSet = {
  accessTokenCifrado: string;
  refreshTokenCifrado: string | null;
  expiresInSeconds: number | null;
};

const SELECT_INTEGRACAO = sql`
  select i.id, i.provider::text as provider, i.access_token_cifrado, i.refresh_token_cifrado,
         (extract(epoch from i.expira_em) * 1000)::float8 as expira_em,
         i.escopos, i.conta_externa::text as conta_externa, i.config::text as config,
         i.conectado_por, u.nome as conectado_por_nome,
         (extract(epoch from i.conectado_em) * 1000)::float8 as conectado_em
  from integracoes i left join usuarios u on u.id = i.conectado_por`;

const toRow = (r: any): IntegracaoRow => ({
  id: r.id,
  provider: r.provider,
  accessTokenCifrado: r.access_token_cifrado,
  refreshTokenCifrado: r.refresh_token_cifrado,
  expiraEm: r.expira_em === null ? null : Number(r.expira_em),
  escopos: r.escopos,
  contaExterna: JSON.parse(r.conta_externa),
  config: JSON.parse(r.config),
  conectadoPor: r.conectado_por,
  conectadoPorNome: r.conectado_por_nome,
  conectadoEm: Number(r.conectado_em),
});

const expiresAt = (seconds: number | null) =>
  seconds === null ? sql`null` : sql`now() + make_interval(secs => ${seconds})`;

class IntegracaoRepository {
  constructor(private readonly db: DrizzleDB) {}

  async list(): Promise<IntegracaoRow[]> {
    return ((await this.db.execute(sql`${SELECT_INTEGRACAO} order by i.provider`)).rows as any[]).map(toRow);
  }

  async find(provider: Provider): Promise<IntegracaoRow | null> {
    const { rows } = await this.db.execute(sql`${SELECT_INTEGRACAO} where i.provider = ${provider}`);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async saveState(provider: Provider, estadoHash: string, usuarioId: string, ttlMinutes: number): Promise<void> {
    await this.db.execute(sql`
      insert into oauth_estados (provider, estado_hash, usuario_id, expira_em)
      values (${provider}, ${estadoHash}, ${usuarioId}, now() + make_interval(mins => ${ttlMinutes}))`);
  }

  // single use: marks it used in the same statement that checks it; null = unknown, used or expired
  async consumeState(provider: Provider, estadoHash: string): Promise<string | null> {
    const { rows } = await this.db.execute(sql`
      update oauth_estados set usado_em = now()
      where provider = ${provider} and estado_hash = ${estadoHash} and usado_em is null and expira_em > now()
      returning usuario_id`);
    return (rows[0] as { usuario_id: string } | undefined)?.usuario_id ?? null;
  }

  // connecting again replaces the tokens; the config is kept only when it's the same external account
  async upsertConnection(input: {
    provider: Provider;
    tokens: TokenSet;
    escopos: string;
    contaExterna: Record<string, unknown>;
    contaChave: string; // the key in contaExterna that identifies the account (Jira: cloudId)
    conectadoPor: string;
  }): Promise<void> {
    const conta = JSON.stringify(input.contaExterna);
    await this.db.execute(sql`
      insert into integracoes (provider, access_token_cifrado, refresh_token_cifrado, expira_em, escopos, conta_externa, conectado_por)
      values (${input.provider}, ${input.tokens.accessTokenCifrado}, ${input.tokens.refreshTokenCifrado},
              ${expiresAt(input.tokens.expiresInSeconds)}, ${input.escopos}, ${conta}::jsonb, ${input.conectadoPor})
      on conflict (provider) do update set
        access_token_cifrado = excluded.access_token_cifrado,
        refresh_token_cifrado = excluded.refresh_token_cifrado,
        expira_em = excluded.expira_em,
        escopos = excluded.escopos,
        config = case
          when integracoes.conta_externa ->> ${input.contaChave} = excluded.conta_externa ->> ${input.contaChave}
          then integracoes.config else '{}'::jsonb end,
        conta_externa = excluded.conta_externa,
        conectado_por = excluded.conectado_por,
        conectado_em = now(),
        atualizado_em = now()`);
  }

  async updateConfig(provider: Provider, config: Record<string, unknown>): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`
      update integracoes set config = ${JSON.stringify(config)}::jsonb, atualizado_em = now()
      where provider = ${provider}`);
    return (rowCount ?? 0) > 0;
  }

  async delete(provider: Provider): Promise<boolean> {
    const { rowCount } = await this.db.execute(sql`delete from integracoes where provider = ${provider}`);
    return (rowCount ?? 0) > 0;
  }

  // Refresh tokens rotate (each refresh returns a new one and retires the old), so concurrent refreshes
  // must not race: the row is locked, and if another request refreshed while we waited, its fresh tokens
  // are used instead of refreshing again. `refresh` returns null when the provider rejected the token.
  async refreshLocked(
    provider: Provider,
    stillValidForSeconds: number,
    refresh: (row: IntegracaoRow) => Promise<TokenSet | null>,
  ): Promise<IntegracaoRow | null> {
    return this.db.transaction(async (tx: DrizzleDB) => {
      const { rows } = await tx.execute(sql`${SELECT_INTEGRACAO} where i.provider = ${provider} for update of i`);
      if (!rows[0]) return null;
      const row = toRow(rows[0]);
      if (row.expiraEm !== null && row.expiraEm > Date.now() + stillValidForSeconds * 1000) return row;
      const tokens = await refresh(row);
      if (!tokens) return null;
      await tx.execute(sql`
        update integracoes set access_token_cifrado = ${tokens.accessTokenCifrado},
          refresh_token_cifrado = coalesce(${tokens.refreshTokenCifrado}, refresh_token_cifrado),
          expira_em = ${expiresAt(tokens.expiresInSeconds)}, atualizado_em = now()
        where provider = ${provider}`);
      const { rows: updated } = await tx.execute(sql`${SELECT_INTEGRACAO} where i.provider = ${provider}`);
      return toRow(updated[0]);
    });
  }
}

export default IntegracaoRepository;
