import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

export type Canal = "hubspot" | "whatsapp";

// envios_externos (drizzle/0026): one row per message the ERP sent outside itself (a HubSpot timeline
// note, a WhatsApp message), keyed by what it is about (e.g. "nota:fatura:in_123"). A sender reserves the
// key before calling the provider and frees it if the call fails, so the at-least-once paths (billing
// webhooks, worker retries, the timeline backfill) never post the same thing twice.
class EnviosExternosRepository {
  constructor(private readonly db: DrizzleDB) {}

  // true when this caller now owns the key; false when it was already sent (or is being sent)
  async reservar(chave: string, canal: Canal): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      insert into envios_externos (chave, canal) values (${chave}, ${canal})
      on conflict (chave) do nothing returning chave`);
    return rows.length > 0;
  }

  async confirmar(chave: string, referencia: string | null): Promise<void> {
    await this.db.execute(sql`update envios_externos set referencia = ${referencia} where chave = ${chave}`);
  }

  async liberar(chave: string): Promise<void> {
    await this.db.execute(sql`delete from envios_externos where chave = ${chave}`);
  }

  // which of these keys were already sent, for the backfill to skip them without reserving one by one
  async existentes(chaves: string[]): Promise<Set<string>> {
    if (chaves.length === 0) return new Set();
    const { rows } = await this.db.execute(sql`
      select chave from envios_externos where chave in (${sql.join(chaves.map((c) => sql`${c}`), sql`, `)})`);
    return new Set((rows as { chave: string }[]).map((r) => r.chave));
  }
}

export default EnviosExternosRepository;
