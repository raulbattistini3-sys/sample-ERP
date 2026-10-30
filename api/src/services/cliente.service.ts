import ClienteRepository, { ClienteHubspot } from "../repositories/cliente.repository";
import HubspotService, { HubspotContact } from "./hubspot.service";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";

const toCliente = ({ id, properties: p, url }: HubspotContact): ClienteHubspot => ({
  hubspotId: id,
  nome: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || `Contato ${id}`,
  email: p.email ?? null,
  telefone: p.phone ?? null,
  empresa: p.company ?? null,
  estagio: p.lifecyclestage ?? null,
  url: url ?? null,
  criadoEm: p.createdate ?? null,
  atualizadoEm: p.lastmodifieddate ?? null,
});

// Customers are HubSpot's contacts: read from the local copy, refreshed on demand.
class ClienteService {
  private sincronizando = false;

  constructor(
    private readonly clientes: ClienteRepository,
    private readonly hubspot: HubspotService,
  ) {}

  listar(page: number, amount: number, busca: string) {
    return this.clientes.listar(page, amount, busca);
  }

  // Page by page, so a big account doesn't sit in memory. Removals only happen after the last page: a
  // sync that fails halfway keeps what was there, and the next one finishes the job.
  async sincronizar(): Promise<Either<BaseAppError, { sincronizados: number; removidos: number }>> {
    if (this.sincronizando) return left(new ValidationError("409", "A sincronização já está em andamento."));
    this.sincronizando = true;
    try {
      const inicio = await this.clientes.agora();
      let sincronizados = 0;
      let after: string | undefined;
      do {
        const pagina = await this.hubspot.listContacts(after);
        if (pagina.isLeft()) return left(pagina.value);
        await this.clientes.salvar(pagina.value.contacts.map(toCliente));
        sincronizados += pagina.value.contacts.length;
        after = pagina.value.after;
      } while (after);
      return right({ sincronizados, removidos: await this.clientes.removerAusentes(inicio) });
    } finally {
      this.sincronizando = false;
    }
  }
}

export default ClienteService;
