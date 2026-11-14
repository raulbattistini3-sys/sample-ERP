import HubspotService, { ContactWrite, HubspotCompany, HubspotContact, SEARCH_LIMIT } from "./hubspot.service";
import ClienteSenioridadeRepository from "../repositories/cliente_senioridade.repository";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import FirstPageCache, { FIRST_PAGE_SIZE } from "../utils/cache/first_page.cache";
import EscritasRecentes from "../utils/cache/escritas_recentes";
import { ClienteInput, SENIORIDADES } from "../utils/schemas/cliente.schema";
import ClienteValidator from "../validators/cliente.validator";

export { SENIORIDADES };

export type ClienteDto = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  // the HubSpot company the contact belongs to (its primary association); null: none, it shows as "sem empresa"
  empresaId: string | null;
  estagio: string | null;
  url: string | null;
  cargo: string | null;
  senioridade: string | null;
  // "erp": set in the ERP (cliente_senioridades); "hubspot": HubSpot's hs_seniority; null: neither has one
  senioridadeOrigem: "erp" | "hubspot" | null;
  papeis: string[];
  // the name as HubSpot splits it, for the edit form
  primeiroNome: string | null;
  sobrenome: string | null;
};

export type ContatoRanqueadoDto = Omit<ClienteDto, "telefone" | "empresa" | "empresaId" | "estagio" | "primeiroNome" | "sobrenome"> & {
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

export type ClienteSalvo = { cliente: ClienteDto; aviso: string | null };

type PaginaDeClientes = { data: ClienteDto[]; totalItems: number };
type PaginaDeEmpresas = { data: EmpresaDto[]; totalItems: number; semEmpresa: number };
type Empresa = Omit<EmpresaDto, "total_contatos" | "total_decisores" | "contatos">;

const CONTATOS_POR_EMPRESA = 25;
// 30 companies with 25 contacts each, at a few hundred bytes per contact
const CLIENTES_CACHE_BYTES = 64 * 1024;
const EMPRESAS_CACHE_BYTES = 1024 * 1024;
const DECISOR = "DECISION_MAKER";

export type VinculoEmpresa = { vinculados: string[]; falhas: { clienteId: string; mensagem: string }[] };

const toContactWrite = (c: ClienteInput): ContactWrite => ({
  firstname: c.primeiroNome,
  lastname: c.sobrenome,
  email: c.email,
  phone: c.telefone,
  company: c.empresa,
  jobtitle: c.cargo,
});

// the contact's buying roles with Decision maker added or removed, keeping the others
const papeisCom = (papeis: string[], decisor: boolean) => {
  const outros = papeis.filter((p) => p !== DECISOR);
  return (decisor ? [DECISOR, ...outros] : outros).join(";");
};

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
  empresaId: p.associatedcompanyid || null,
  estagio: p.lifecyclestage ?? null,
  url: url ?? null,
  cargo: p.jobtitle?.trim() || null,
  senioridade: p.hs_seniority || null,
  senioridadeOrigem: p.hs_seniority ? "hubspot" : null,
  papeis: p.hs_buying_role ? p.hs_buying_role.split(";").filter(Boolean) : [],
  primeiroNome: p.firstname ?? null,
  sobrenome: p.lastname ?? null,
});

// the senioridade set in the ERP wins over HubSpot's
const comSenioridade = (cliente: ClienteDto, erp: Map<string, string>): ClienteDto => {
  const propria = erp.get(cliente.id);
  return propria ? { ...cliente, senioridade: propria, senioridadeOrigem: "erp" } : cliente;
};

const eDecisor = (cliente: ClienteDto) => cliente.papeis.includes(DECISOR);

const senioridade = ({ senioridade }: ClienteDto) => {
  const posicao = (SENIORIDADES as readonly string[]).indexOf(senioridade ?? "");
  return posicao === -1 ? SENIORIDADES.length : posicao;
};

// the rank within a company: decision makers, then seniority, then name
const porRank = (a: ClienteDto, b: ClienteDto) =>
  Number(eDecisor(b)) - Number(eDecisor(a)) || senioridade(a) - senioridade(b) || a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id);

// Customers are HubSpot's contacts and companies, read live: nothing of them is kept in the database, only
// the first load of each list stays in memory, per session. The ERP writes back to HubSpot (create, edit)
// and keeps in its own table only what HubSpot doesn't hold for it: the senioridade set here.
class ClienteService {
  private readonly validator = new ClienteValidator();
  private readonly primeirosClientes = new FirstPageCache<PaginaDeClientes>(CLIENTES_CACHE_BYTES);
  private readonly primeirasEmpresas = new FirstPageCache<PaginaDeEmpresas>(EMPRESAS_CACHE_BYTES);
  // what was just saved here, laid over HubSpot's search while its index catches up (see EscritasRecentes)
  private readonly contatosRecentes = new EscritasRecentes<ClienteDto & { novo: boolean }>();
  private readonly empresasRecentes = new EscritasRecentes<Empresa>();

  constructor(
    private readonly hubspot: HubspotService,
    private readonly senioridades: ClienteSenioridadeRepository,
  ) {}

  // a company was created or edited elsewhere (Criar empresa): the cached first pages are stale
  limparCaches() {
    this.primeirosClientes.clear();
    this.primeirasEmpresas.clear();
  }

  // a company just created or edited (Criar empresa): shown in the lists before HubSpot's search finds it
  lembrarEmpresa(empresa: HubspotCompany) {
    this.empresasRecentes.gravar(empresa.id, toEmpresa(empresa));
    this.limparCaches();
  }

  // search may still have the contact without its company: the company just saved here wins
  private comRecente(cliente: ClienteDto): ClienteDto {
    const recente = this.contatosRecentes.ler(cliente.id);
    return recente ? { ...cliente, empresaId: recente.empresaId, empresa: recente.empresa } : cliente;
  }

  private lembrarContato(cliente: ClienteDto, novo: boolean) {
    const anterior = this.contatosRecentes.ler(cliente.id);
    this.contatosRecentes.gravar(cliente.id, { ...cliente, novo: novo || !!anterior?.novo });
  }

  listar(sessao: string, page: number, amount: number, busca: string) {
    const cacheavel = page === 1 && amount === FIRST_PAGE_SIZE && !busca;
    return this.primeirosClientes.read(sessao, cacheavel, () => this.buscarClientes(page, amount, busca));
  }

  listarEmpresas(sessao: string, page: number, amount: number, busca: string, soDecisores: boolean) {
    const cacheavel = page === 1 && amount === FIRST_PAGE_SIZE && !busca && !soDecisores;
    return this.primeirasEmpresas.read(sessao, cacheavel, () => this.buscarEmpresas(page, amount, busca, soDecisores));
  }

  async obter(id: string): Promise<Either<BaseAppError, ClienteDto>> {
    const idValido = this.validator.validateHubspotId(id, "cliente");
    if (idValido.isLeft()) return left(idValido.value);
    const contato = await this.hubspot.readContact(id);
    if (contato.isLeft()) return left(contato.value);
    if (!contato.value) return left(new ValidationError("404", "Cliente não encontrado no HubSpot."));
    const cliente = toCliente(contato.value);
    // associatedcompanyid is filled a moment after the link
    const recente = this.contatosRecentes.ler(id);
    const atual = recente && !cliente.empresaId ? { ...cliente, empresaId: recente.empresaId, empresa: recente.empresa } : cliente;
    return right(comSenioridade(atual, await this.senioridades.porContatos([id])));
  }

  // Creates the contact in HubSpot and links it to its company there (the link is what puts it under the
  // company), then keeps its senioridade here.
  async criar(payload: unknown, usuarioId: string): Promise<Either<BaseAppError, ClienteSalvo>> {
    const parsed = this.validator.parseCliente(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const dados = parsed.value;
    // a new client always starts under a company: without one it would only show up in "sem empresa"
    if (!dados.empresaId && !dados.empresa) return left(new ValidationError("400", "Escolha a empresa do cliente (ou crie a empresa antes)."));
    const empresa = await this.resolverEmpresa(dados, new Map());
    if (empresa.isLeft()) return left(empresa.value);
    const criado = await this.hubspot.createContact({
      ...toContactWrite(dados),
      company: empresa.value?.nome ?? dados.empresa,
      hs_buying_role: dados.decisor ? DECISOR : undefined,
    });
    if (criado.isLeft()) return left(criado.value);
    const id = criado.value.id;
    const avisos: string[] = [];
    if (empresa.value) {
      const vinculo = await this.hubspot.linkContactsToCompanies([{ contactId: id, companyId: empresa.value.id }]);
      if (vinculo.isLeft()) avisos.push(`O contato foi criado, mas não foi ligado à empresa ${empresa.value.nome}: ${vinculo.value.message}`);
    }
    return right(await this.depoisDeSalvar(id, dados, usuarioId, avisos, empresa.value, true));
  }

  // the same form: every HubSpot field is written, an empty one is cleared there
  async atualizar(id: string, payload: unknown, usuarioId: string): Promise<Either<BaseAppError, ClienteSalvo>> {
    const idValido = this.validator.validateHubspotId(id, "cliente");
    if (idValido.isLeft()) return left(idValido.value);
    const parsed = this.validator.parseCliente(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const dados = parsed.value;
    const atual = await this.hubspot.readContact(id);
    if (atual.isLeft()) return left(atual.value);
    if (!atual.value) return left(new ValidationError("404", "Cliente não encontrado no HubSpot."));
    const empresa = await this.resolverEmpresa(dados, new Map());
    if (empresa.isLeft()) return left(empresa.value);
    const papeis = toCliente(atual.value).papeis;
    const salvo = await this.hubspot.updateContact(id, {
      ...toContactWrite(dados),
      company: empresa.value?.nome ?? dados.empresa,
      hs_buying_role: dados.decisor === undefined ? undefined : papeisCom(papeis, dados.decisor),
    });
    if (salvo.isLeft()) return left(salvo.value);

    // moving to another company: the old links go, so the contact shows under one company only
    const avisos: string[] = [];
    const vinculos = await this.hubspot.associated("contacts", "companies", [id]);
    if (vinculos.isLeft()) {
      avisos.push(`O contato foi salvo, mas a empresa não foi conferida: ${vinculos.value.message}`);
    } else {
      const atuais = vinculos.value.get(id) ?? [];
      const sair = atuais.filter((empresaId) => empresaId !== empresa.value?.id);
      const desfeito = await this.hubspot.unlinkContactFromCompanies(id, sair);
      if (desfeito.isLeft()) avisos.push(`O contato continua ligado à empresa anterior: ${desfeito.value.message}`);
      if (empresa.value) {
        const vinculo = await this.hubspot.linkContactsToCompanies([{ contactId: id, companyId: empresa.value.id }]);
        if (vinculo.isLeft()) avisos.push(`O contato foi salvo, mas não foi ligado à empresa ${empresa.value.nome}: ${vinculo.value.message}`);
      }
    }
    return right(await this.depoisDeSalvar(id, dados, usuarioId, avisos, empresa.value, false));
  }

  // The clientes under a company (its contacts in HubSpot), for the Empresa page.
  async listarDaEmpresa(empresaId: string): Promise<Either<BaseAppError, ClienteDto[]>> {
    const idValido = this.validator.validateHubspotId(empresaId, "empresa");
    if (idValido.isLeft()) return left(idValido.value);
    const vinculos = await this.hubspot.associated("companies", "contacts", [empresaId]);
    if (vinculos.isLeft()) return left(vinculos.value);
    const ids = vinculos.value.get(empresaId) ?? [];
    if (!ids.length) return right([]);
    const contatos = await this.hubspot.readContacts(ids);
    if (contatos.isLeft()) return left(contatos.value);
    const senioridades = await this.senioridades.porContatos(ids);
    return right(
      contatos.value
        .map((c) => comSenioridade({ ...toCliente(c), empresaId }, senioridades))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    );
  }

  // A cliente registered before its company existed: links it (one company per cliente, so its other
  // links go) and writes the company name on the contact, the same as saving it with that Empresa picked.
  async vincularEmpresa(empresaId: string, payload: unknown): Promise<Either<BaseAppError, VinculoEmpresa>> {
    const idValido = this.validator.validateHubspotId(empresaId, "empresa");
    if (idValido.isLeft()) return left(idValido.value);
    const parsed = this.validator.parseVinculo(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const clienteIds = [...new Set(parsed.value.clienteIds)];
    const empresa = await this.hubspot.readCompany(empresaId);
    if (empresa.isLeft()) return left(empresa.value);
    if (!empresa.value) return left(new ValidationError("404", "Empresa não encontrada no HubSpot."));
    const nome = toEmpresa(empresa.value).nome;
    this.empresasRecentes.gravar(empresaId, toEmpresa(empresa.value));

    const atuais = await this.hubspot.associated("contacts", "companies", clienteIds);
    if (atuais.isLeft()) return left(atuais.value);
    const falhas: { clienteId: string; mensagem: string }[] = [];
    const ligar: string[] = [];
    for (const clienteId of clienteIds) {
      const sair = (atuais.value.get(clienteId) ?? []).filter((id) => id !== empresaId);
      const desfeito = await this.hubspot.unlinkContactFromCompanies(clienteId, sair);
      if (desfeito.isLeft()) {
        falhas.push({ clienteId, mensagem: `Continua ligado à empresa anterior: ${desfeito.value.message}` });
        continue;
      }
      const salvo = await this.hubspot.updateContact(clienteId, { company: nome });
      if (salvo.isLeft()) {
        falhas.push({ clienteId, mensagem: salvo.value.message });
        continue;
      }
      ligar.push(clienteId);
    }
    if (ligar.length) {
      const vinculo = await this.hubspot.linkContactsToCompanies(ligar.map((contactId) => ({ contactId, companyId: empresaId })));
      if (vinculo.isLeft()) {
        for (const clienteId of ligar) falhas.push({ clienteId, mensagem: vinculo.value.message });
        ligar.length = 0;
      }
    }
    if (ligar.length) {
      const lidos = await this.hubspot.readContacts(ligar);
      if (lidos.isRight()) for (const c of lidos.value) this.lembrarContato({ ...toCliente(c), empresaId, empresa: nome }, false);
    }
    this.limparCaches();
    return right({ vinculados: ligar, falhas });
  }

  // The company a save points at: the one picked by id, else the one named in `empresa` (found by name, or
  // created). `cache` keeps the lookups of one request, so a sheet with 100 rows of "Acme" creates one Acme.
  private async resolverEmpresa(
    dados: ClienteInput,
    cache: Map<string, { id: string; nome: string; criada: boolean } | null>,
  ): Promise<Either<BaseAppError, { id: string; nome: string } | null>> {
    if (dados.empresaId) {
      const empresa = await this.hubspot.readCompany(dados.empresaId);
      if (empresa.isLeft()) return left(empresa.value);
      if (!empresa.value) return left(new ValidationError("404", "A empresa escolhida não existe mais no HubSpot."));
      return right({ id: empresa.value.id, nome: toEmpresa(empresa.value).nome });
    }
    const nome = dados.empresa?.trim();
    if (!nome) return right(null);
    const chave = nome.toLocaleLowerCase("pt-BR");
    if (cache.has(chave)) return right(cache.get(chave) ?? null);
    // created a moment ago: search doesn't find it yet, and a second one must not be created
    const recente = this.empresasRecentes.todos().find((e) => e.nome.toLocaleLowerCase("pt-BR") === chave);
    if (recente) return right({ id: recente.id, nome: recente.nome });
    const achadas = await this.hubspot.findCompaniesByName(nome);
    if (achadas.isLeft()) return left(achadas.value);
    if (achadas.value[0]) {
      const achada = { id: achadas.value[0].id, nome: toEmpresa(achadas.value[0]).nome, criada: false };
      cache.set(chave, achada);
      return right(achada);
    }
    const criada = await this.hubspot.createCompany({ name: nome });
    if (criada.isLeft()) return left(criada.value);
    const nova = { id: criada.value.id, nome, criada: true };
    cache.set(chave, nova);
    this.empresasRecentes.gravar(nova.id, toEmpresa(criada.value));
    return right(nova);
  }

  // HubSpot already has the contact by now: a failure here is reported, not undone there
  private async depoisDeSalvar(
    id: string,
    dados: ClienteInput,
    usuarioId: string,
    avisos: string[],
    empresa: { id: string; nome: string } | null,
    novo: boolean,
  ): Promise<ClienteSalvo> {
    const salvo = await this.salvarLocal(id, dados, usuarioId, avisos, empresa);
    this.lembrarContato(salvo.cliente, novo);
    this.limparCaches();
    return salvo;
  }

  private async salvarLocal(id: string, dados: ClienteInput, usuarioId: string, avisos: string[], empresa: { id: string; nome: string } | null): Promise<ClienteSalvo> {
    const empresaId = empresa?.id ?? null;
    if (dados.senioridade !== undefined) {
      try {
        await this.senioridades.definir(id, dados.senioridade, usuarioId);
      } catch {
        avisos.push("O contato foi salvo no HubSpot, mas a senioridade não foi gravada. Salve de novo para tentar outra vez.");
      }
    }
    const aviso = avisos.length ? avisos.join(" ") : null;
    // read back for every property (create and update answer only with the ones written). HubSpot fills
    // associatedcompanyid a moment after the link, so the company just linked is used until it does.
    const lido = await this.obter(id);
    if (lido.isRight()) {
      return { cliente: { ...lido.value, empresaId: lido.value.empresaId ?? empresaId, empresa: empresa?.nome ?? lido.value.empresa }, aviso };
    }
    const nome = [dados.primeiroNome, dados.sobrenome].filter(Boolean).join(" ");
    const cliente: ClienteDto = {
      id,
      nome,
      email: dados.email,
      telefone: dados.telefone,
      empresa: empresa?.nome ?? dados.empresa,
      empresaId,
      estagio: null,
      url: null,
      cargo: dados.cargo,
      senioridade: dados.senioridade ?? null,
      senioridadeOrigem: dados.senioridade ? "erp" : null,
      papeis: dados.decisor ? [DECISOR] : [],
      primeiroNome: dados.primeiroNome,
      sobrenome: dados.sobrenome,
    };
    return { cliente, aviso };
  }

  private async buscarClientes(page: number, amount: number, busca: string): Promise<Either<BaseAppError, PaginaDeClientes>> {
    const contatos = await this.hubspot.searchContacts(page, amount, busca);
    if (contatos.isLeft()) return left(contatos.value);
    const { results = [], total = 0 } = contatos.value;
    const erp = await this.senioridades.porContatos(results.map(({ id }) => id));
    let data = results.map((c) => this.comRecente(comSenioridade(toCliente(c), erp)));
    let totalItems = Math.min(total, SEARCH_LIMIT);
    // the first page also shows the clients just created that search doesn't return yet
    if (page === 1 && !busca) {
      const vistos = new Set(data.map(({ id }) => id));
      const faltando = this.contatosRecentes
        .todos()
        .filter((c) => c.novo && !vistos.has(c.id))
        .map(({ novo: _novo, ...cliente }) => cliente);
      if (faltando.length) {
        data = [...faltando, ...data].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        totalItems += faltando.length;
      }
    }
    return right({ data, totalItems });
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
        .map(({ cliente: { telefone, empresa: _empresa, empresaId: _empresaId, estagio, primeiroNome, sobrenome, ...contato }, posicao }) => ({ ...contato, posicao }));
      return { ...empresa, total_contatos: ranqueados.length, total_decisores: ranqueados.filter(eDecisor).length, contatos: topo };
    });
    return right({ data, totalItems, semEmpresa: semEmpresa.value });
  }

  private async paginaDeEmpresas(page: number, amount: number, busca: string): Promise<Either<BaseAppError, { empresas: Empresa[]; totalItems: number }>> {
    const empresas = await this.hubspot.searchCompanies(page, amount, busca);
    if (empresas.isLeft()) return left(empresas.value);
    const { results = [], total = 0 } = empresas.value;
    let lista = results.map(toEmpresa);
    let totalItems = Math.min(total, SEARCH_LIMIT);
    // companies created a moment ago, which search doesn't return yet
    if (page === 1) {
      const termo = busca.toLowerCase();
      const vistas = new Set(lista.map(({ id }) => id));
      const faltando = this.empresasRecentes
        .todos()
        .filter((e) => !vistas.has(e.id) && (!termo || e.nome.toLowerCase().includes(termo) || !!e.dominio?.toLowerCase().includes(termo)));
      if (faltando.length) {
        lista = [...faltando, ...lista].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        totalItems += faltando.length;
      }
    }
    return right({ empresas: lista, totalItems });
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
    const erp = await this.senioridades.porContatos([...new Set(contatos.value.map(({ id }) => id))]);
    const porId = new Map(contatos.value.map((contato) => [contato.id, comSenioridade(toCliente(contato), erp)]));
    const resultado = new Map<string, ClienteDto[]>();
    for (const [empresaId, ids] of vinculos.value) {
      resultado.set(empresaId, ids.flatMap((id) => porId.get(id) ?? []));
    }
    return right(resultado);
  }
}

export default ClienteService;
