import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

export const MARCACOES = ["favorito", "depois"] as const;
export type Marcacao = (typeof MARCACOES)[number];

// produto_marcacoes (drizzle/0023_empresas_marcacoes_cc.sql): each user's own favourites and "save for
// later" list. Marking twice or unmarking what isn't marked is a no-op, so a retried request is harmless.
class ProdutoMarcacaoRepository {
  constructor(private readonly db: DrizzleDB) {}

  async listar(usuarioId: string): Promise<Record<Marcacao, string[]>> {
    const { rows } = await this.db.execute(sql`
      select produto_id, tipo from produto_marcacoes where usuario_id = ${usuarioId} order by criado_em desc`);
    const marcacoes: Record<Marcacao, string[]> = { favorito: [], depois: [] };
    for (const r of rows as { produto_id: string; tipo: Marcacao }[]) marcacoes[r.tipo]?.push(r.produto_id);
    return marcacoes;
  }

  // only ids of existing products are marked (the FK would refuse the others and fail the whole batch)
  async marcar(usuarioId: string, ids: string[], tipo: Marcacao): Promise<number> {
    const { rows } = await this.db.execute(sql`
      insert into produto_marcacoes (usuario_id, produto_id, tipo)
      select ${usuarioId}::uuid, p.id, ${tipo} from produtos p where p.id = any(${sql.param(ids)}::uuid[])
      on conflict do nothing
      returning produto_id`);
    return rows.length;
  }

  async desmarcar(usuarioId: string, ids: string[], tipo: Marcacao): Promise<number> {
    const { rows } = await this.db.execute(sql`
      delete from produto_marcacoes
      where usuario_id = ${usuarioId} and tipo = ${tipo} and produto_id = any(${sql.param(ids)}::uuid[])
      returning produto_id`);
    return rows.length;
  }
}

export default ProdutoMarcacaoRepository;
