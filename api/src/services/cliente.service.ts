import ClienteRepository, { ClienteHubspot, EmpresaHubspot } from "../repositories/cliente.repository";
import HubspotService, { HubspotCompany, HubspotContact } from "./hubspot.service";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";

const toEmpresa = ({ id, properties: p, url }: HubspotCompany): EmpresaHubspot => ({
  hubspotId: id,
  nome: p.name || p.domain || `Empresa ${id}`,
  dominio: p.domain ?? null,
  setor: p.industry ?? null,
  url: url ?? null,
});

const toCliente = ({ id, properties: p, url, associations }: HubspotContact): ClienteHubspot => ({
  hubspotId: id,
  nome: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || `Contato ${id}`,
  email: p.email ?? null,
  telefone: p.phone ?? null,
  empresa: p.company ?? null,
  estagio: p.lifecyclestage ?? null,
  url: url ?? null,
  criadoEm: p.createdate ?? null,
  atualizadoEm: p.lastmodifieddate ?? null,
  cargo: p.jobtitle?.trim() || null,
  senioridade: p.hs_seniority || null,
  papeis: p.hs_buying_role ? p.hs_buying_role.split(";").filter(Boolean) : [],
  empresasHubspotIds: [...new Set((associations?.companies?.results ?? []).map((c) => c.id))],
});

// Customers are HubSpot's contacts and companies: read from the local copy, refreshed on demand.
class ClienteService {
  private sincronizando = false;

  constructor(
    private readonly clientes: ClienteRepository,
    private readonly hubspot: HubspotService,
  ) {}

  listar(page: number, amount: number, busca: string) {
    return this.clientes.listar(page, amount, busca);
  }

  listarEmpresas(page: number, amount: number, busca: string, soDecisores: boolean) {
    return this.clientes.listarEmpresas(page, amount, busca, soDecisores);
  }

  // every page of one kind of record; returns how many there were
  private async percorrer<T>(
    ler: (after?: string) => Promise<Either<BaseAppError, { results: T[]; after?: string }>>,
    salvar: (pagina: T[]) => Promise<void>,
  ): Promise<Either<BaseAppError, number>> {
    let total = 0;
    let after: string | undefined;
    do {
      const pagina = await ler(after);
      if (pagina.isLeft()) return left(pagina.value);
      await salvar(pagina.value.results);
      total += pagina.value.results.length;
      after = pagina.value.after;
    } while (after);
    return right(total);
  }

  // Page by page, so a big account doesn't sit in memory. Removals only happen after the last page: a
  // sync that fails halfway keeps what was there, and the next one finishes the job.
  async sincronizar(): Promise<Either<BaseAppError, { sincronizados: number; empresas: number; removidos: number }>> {
    if (this.sincronizando) return left(new ValidationError("409", "A sincronização já está em andamento."));
    this.sincronizando = true;
    try {
      const inicio = await this.clientes.agora();
      const empresas = await this.percorrer(
        (after) => this.hubspot.listCompanies(after),
        (pagina) => this.clientes.salvarEmpresas(pagina.map(toEmpresa)),
      );
      if (empresas.isLeft()) return left(empresas.value);
      const sincronizados = await this.percorrer(
        (after) => this.hubspot.listContacts(after),
        (pagina) => this.clientes.salvar(pagina.map(toCliente)),
      );
      if (sincronizados.isLeft()) return left(sincronizados.value);
      const removidos = await this.clientes.removerAusentes(inicio);
      return right({ sincronizados: sincronizados.value, empresas: empresas.value, removidos });
    } finally {
      this.sincronizando = false;
    }
  }
}

export default ClienteService;
