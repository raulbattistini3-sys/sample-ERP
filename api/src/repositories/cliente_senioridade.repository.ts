import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// cliente_senioridades (drizzle/0022_clientes_erp.sql): the senioridade the ERP sets on a HubSpot
// contact, keyed by the contact's id. Only this field lives here; the contact itself stays in HubSpot.
class ClienteSenioridadeRepository {
  constructor(private readonly db: DrizzleDB) {}

  async porContatos(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.db.execute(sql`
      select hubspot_contato_id, senioridade from cliente_senioridades
      where hubspot_contato_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    return new Map((rows as { hubspot_contato_id: string; senioridade: string }[]).map((r) => [r.hubspot_contato_id, r.senioridade]));
  }

  // null clears it, so the list falls back to HubSpot's hs_seniority
  async definir(contatoId: string, senioridade: string | null, usuarioId: string): Promise<void> {
    if (senioridade === null) {
      await this.db.execute(sql`delete from cliente_senioridades where hubspot_contato_id = ${contatoId}`);
      return;
    }
    await this.db.execute(sql`
      insert into cliente_senioridades (hubspot_contato_id, senioridade, atualizado_por)
      values (${contatoId}, ${senioridade}, ${usuarioId})
      on conflict (hubspot_contato_id) do update
        set senioridade = excluded.senioridade, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
  }
}

export default ClienteSenioridadeRepository;
