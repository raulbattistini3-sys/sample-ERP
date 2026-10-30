import HubspotService, { HubspotCompany, HubspotContact, SEARCH_LIMIT } from "./hubspot.service";
import { BaseAppError } from "../errors/global_error.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import FirstPageCache, { FIRST_PAGE_SIZE } from "../utils/cache/first_page.cache";

export type ClienteDto = {
  id: string;
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

export type ContatoRanqueadoDto = Omit<ClienteDto, "telefone" | "empresa" | "estagio"> & {
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

type PaginaDeClientes = { data: ClienteDto[]; totalItems: number };
type PaginaDeEmpresas = { data: EmpresaDto[]; totalItems: number; semEmpresa: number };
type Empresa = Omit<EmpresaDto, "total_contatos" | "total_decisores" | "contatos">;

const CONTATOS_POR_EMPRESA = 25;
// 30 companies with 25 contacts each, at a few hundred bytes per contact
const CLIENTES_CACHE_BYTES = 64 * 1024;
const EMPRESAS_CACHE_BYTES = 1024 * 1024;
const DECISOR = "DECISION_MAKER";
// hs_seniority's values, highest first
const SENIORIDADES = ["owner", "partner", "executive", "vp", "director", "manager", "senior", "employee", "entry"];

const toEmpresa = ({ id, properties: p, url }: HubspotCompany): Empresa => ({
  id,
  nome: p.name || p.domain || `Empresa ${id}`,
  dominio: p.domain ?? null,
  setor: p.industry ?? null,
  url: url ?? null,
});

const toCliente = ({ id, properties: p, url }: HubspotContact): ClienteDto => ({
  id,
  nome: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || `Contato ${id}`,
  email: p.email ?? null,
  telefone: p.phone ?? null,
  empresa: p.company ?? null,
  estagio: p.lifecyclestage ?? null,
  url: url ?? null,
  cargo: p.jobtitle?.trim() || null,
  senioridade: p.hs_seniority || null,
  papeis: p.hs_buying_role ? p.hs_buying_role.split(";").filter(Boolean) : [],
});

const eDecisor = (cliente: ClienteDto) => cliente.papeis.includes(DECISOR);

const senioridade = ({ senioridade }: ClienteDto) => {
  const posicao = SENIORIDADES.indexOf(senioridade ?? "");
  return posicao === -1 ? SENIORIDADES.length : posicao;
};

// the rank within a company: decision makers, then seniority, then name
const porRank = (a: ClienteDto, b: ClienteDto) =>
  Number(eDecisor(b)) - Number(eDecisor(a)) || senioridade(a) - senioridade(b) || a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id);

// Customers are HubSpot's contacts and companies, read live: nothing is kept in the database, only the
// first load of each list stays in memory, per session.
class ClienteService {
  private readonly primeirosClientes = new FirstPageCache<PaginaDeClientes>(CLIENTES_CACHE_BYTES);
  private readonly primeirasEmpresas = new FirstPageCache<PaginaDeEmpresas>(EMPRESAS_CACHE_BYTES);

  constructor(private readonly hubspot: HubspotService) {}

  listar(sessao: string, page: number, amount: number, busca: string) {
    const cacheavel = page === 1 && amount === FIRST_PAGE_SIZE && !busca;
    return this.primeirosClientes.read(sessao, cacheavel, () => this.buscarClientes(page, amount, busca));
  }

  listarEmpresas(sessao: string, page: number, amount: number, busca: string, soDecisores: boolean) {
    const cacheavel = page === 1 && amount === FIRST_PAGE_SIZE && !busca && !soDecisores;
    return this.primeirasEmpresas.read(sessao, cacheavel, () => this.buscarEmpresas(page, amount, busca, soDecisores));
  }

  private async buscarClientes(page: number, amount: number, busca: string): Promise<Either<BaseAppError, PaginaDeClientes>> {
    const contatos = await this.hubspot.searchContacts(page, amount, busca);
    if (contatos.isLeft()) return left(contatos.value);
    const { results = [], total = 0 } = contatos.value;
    return right({ data: results.map(toCliente), totalItems: Math.min(total, SEARCH_LIMIT) });
  }

  private async buscarEmpresas(page: number, amount: number, busca: string, soDecisores: boolean): Promise<Either<BaseAppError, PaginaDeEmpresas>> {
    const pagina = soDecisores ? await this.empresasComDecisor(page, amount, busca) : await this.paginaDeEmpresas(page, amount, busca);
    if (pagina.isLeft()) return left(pagina.value);
    const { empresas, totalItems } = pagina.value;

    const contatos = await this.contatosPorEmpresa(empresas.map(({ id }) => id));
    if (contatos.isLeft()) return left(contatos.value);
    const semEmpresa = await this.hubspot.countContactsWithoutCompany();
    if (semEmpresa.isLeft()) return left(semEmpresa.value);

    const data = empresas.map((empresa) => {
      const ranqueados = (contatos.value.get(empresa.id) ?? []).sort(porRank);
      const topo = ranqueados
        .slice(0, CONTATOS_POR_EMPRESA)
        .map((cliente, index) => ({ cliente, posicao: index + 1 }))
        .filter(({ cliente }) => !soDecisores || eDecisor(cliente))
        .map(({ cliente: { telefone, empresa: _empresa, estagio, ...contato }, posicao }) => ({ ...contato, posicao }));
      return { ...empresa, total_contatos: ranqueados.length, total_decisores: ranqueados.filter(eDecisor).length, contatos: topo };
    });
    return right({ data, totalItems, semEmpresa: semEmpresa.value });
  }

  private async paginaDeEmpresas(page: number, amount: number, busca: string): Promise<Either<BaseAppError, { empresas: Empresa[]; totalItems: number }>> {
    const empresas = await this.hubspot.searchCompanies(page, amount, busca);
    if (empresas.isLeft()) return left(empresas.value);
    const { results = [], total = 0 } = empresas.value;
    return right({ empresas: results.map(toEmpresa), totalItems: Math.min(total, SEARCH_LIMIT) });
  }

  // search can't filter companies by their contacts, so this one is filtered and paged here
  private async empresasComDecisor(page: number, amount: number, busca: string): Promise<Either<BaseAppError, { empresas: Empresa[]; totalItems: number }>> {
    const decisores = await this.hubspot.decisionMakerIds();
    if (decisores.isLeft()) return left(decisores.value);
    const vinculos = await this.hubspot.associated("contacts", "companies", decisores.value);
    if (vinculos.isLeft()) return left(vinculos.value);
    const empresas = await this.hubspot.readCompanies([...new Set([...vinculos.value.values()].flat())]);
    if (empresas.isLeft()) return left(empresas.value);

    const termo = busca.toLowerCase();
    const filtradas = empresas.value
      .map(toEmpresa)
      .filter(({ nome, dominio }) => nome.toLowerCase().includes(termo) || !!dominio?.toLowerCase().includes(termo))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id));
    return right({ empresas: filtradas.slice((page - 1) * amount, page * amount), totalItems: filtradas.length });
  }

  private async contatosPorEmpresa(empresaIds: string[]): Promise<Either<BaseAppError, Map<string, ClienteDto[]>>> {
    const vinculos = await this.hubspot.associated("companies", "contacts", empresaIds);
    if (vinculos.isLeft()) return left(vinculos.value);
    const contatos = await this.hubspot.readContacts([...new Set([...vinculos.value.values()].flat())]);
    if (contatos.isLeft()) return left(contatos.value);
    const porId = new Map(contatos.value.map((contato) => [contato.id, toCliente(contato)]));
    const resultado = new Map<string, ClienteDto[]>();
    for (const [empresaId, ids] of vinculos.value) {
      resultado.set(empresaId, ids.flatMap((id) => porId.get(id) ?? []));
    }
    return right(resultado);
  }
}

export default ClienteService;
