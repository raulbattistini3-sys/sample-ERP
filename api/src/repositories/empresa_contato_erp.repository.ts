import { sql } from "drizzle-orm";
import { DrizzleDB } from "../db/client";

// empresa_contatos_erp (drizzle/0023_empresas_marcacoes_cc.sql): what the ERP keeps about a HubSpot company
// that HubSpot doesn't hold for it, keyed by the company's id. Today only the SAC e-mail.
class EmpresaContatoErpRepository {
  constructor(private readonly db: DrizzleDB) {}

  async sacPorEmpresas(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.db.execute(sql`
      select hubspot_empresa_id, email_sac from empresa_contatos_erp
      where email_sac is not null and hubspot_empresa_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    return new Map((rows as { hubspot_empresa_id: string; email_sac: string }[]).map((r) => [r.hubspot_empresa_id, r.email_sac]));
  }

  // null clears it
  async definirSac(empresaId: string, email: string | null, usuarioId: string): Promise<void> {
    if (email === null) {
      await this.db.execute(sql`delete from empresa_contatos_erp where hubspot_empresa_id = ${empresaId}`);
      return;
    }
    await this.db.execute(sql`
      insert into empresa_contatos_erp (hubspot_empresa_id, email_sac, atualizado_por)
      values (${empresaId}, ${email}, ${usuarioId})
      on conflict (hubspot_empresa_id) do update
        set email_sac = excluded.email_sac, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
  }
}

export default EmpresaContatoErpRepository;
