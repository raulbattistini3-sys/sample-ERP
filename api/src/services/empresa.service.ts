import HubspotService, { CompanyWrite, Estagio, estagioDe, HubspotCompany, IndustryOption } from "./hubspot.service";
import EmpresaContatoErpRepository from "../repositories/empresa_contato_erp.repository";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { EmpresaInput } from "../utils/schemas/empresa.schema";
import EmpresaValidator from "../validators/empresa.validator";

export type EmpresaDetalheDto = {
  id: string;
  nome: string;
  dominio: string | null;
  setor: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  pais: string | null;
  site: string | null;
  descricao: string | null;
  // kept in the ERP: copied on the e-mails about a client's failed payment
  emailSac: string | null;
  // the HubSpot user who owns the company (hubspot_owner_id) and its Funil column (lifecyclestage)
  responsavelId: string | null;
  estagio: Estagio;
  url: string | null;
};

export type EmpresaSalva = { empresa: EmpresaDetalheDto; aviso: string | null };

const toCompanyWrite = (e: EmpresaInput): CompanyWrite => ({
  name: e.nome,
  domain: e.dominio,
  industry: e.setor,
  phone: e.telefone,
  city: e.cidade,
  state: e.estado,
  country: e.pais,
  website: e.site,
  description: e.descricao,
  ...(e.responsavelId !== undefined ? { hubspot_owner_id: e.responsavelId } : {}),
});

const toDetalhe = ({ id, properties: p, url }: HubspotCompany, emailSac: string | null): EmpresaDetalheDto => ({
  id,
  nome: p.name || p.domain || `Empresa ${id}`,
  dominio: p.domain || null,
  setor: p.industry || null,
  telefone: p.phone || null,
  cidade: p.city || null,
  estado: p.state || null,
  pais: p.country || null,
  site: p.website || null,
  descricao: p.description || null,
  emailSac,
  responsavelId: p.hubspot_owner_id || null,
  estagio: estagioDe(p.lifecyclestage),
  url: url ?? null,
});

// Criar empresa: the company is created and edited in HubSpot itself (it stays the one place companies live);
// the ERP keeps only its SAC e-mail. `aoMudar` lets the Clientes lists drop their cached first page.
class EmpresaService {
  private readonly validator = new EmpresaValidator();
  private setores: { lidos: IndustryOption[]; em: number } | null = null;

  constructor(
    private readonly hubspot: HubspotService,
    private readonly contatos: EmpresaContatoErpRepository,
    private readonly aoMudar: (empresa: HubspotCompany) => void,
  ) {}

  async obter(id: string): Promise<Either<BaseAppError, EmpresaDetalheDto>> {
    const idValido = this.validator.validateHubspotId(id, "empresa");
    if (idValido.isLeft()) return left(idValido.value);
    const empresa = await this.hubspot.readCompany(id);
    if (empresa.isLeft()) return left(empresa.value);
    if (!empresa.value) return left(new ValidationError("404", "Empresa não encontrada no HubSpot."));
    const sac = await this.contatos.sacPorEmpresas([id]);
    return right(toDetalhe(empresa.value, sac.get(id) ?? null));
  }

  async criar(payload: unknown, usuarioId: string): Promise<Either<BaseAppError, EmpresaSalva>> {
    const parsed = this.validator.parseEmpresa(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const repetidas = await this.hubspot.findCompaniesByName(parsed.value.nome);
    if (repetidas.isLeft()) return left(repetidas.value);
    if (repetidas.value.length > 0) {
      return left(new ValidationError("409", `Já existe uma empresa "${parsed.value.nome}" no HubSpot. Edite a existente em vez de criar outra.`));
    }
    const criada = await this.hubspot.createCompany(toCompanyWrite(parsed.value));
    if (criada.isLeft()) return left(criada.value);
    return right(await this.depoisDeSalvar(criada.value, parsed.value, usuarioId));
  }

  // every field is written: an empty one is cleared in HubSpot
  async atualizar(id: string, payload: unknown, usuarioId: string): Promise<Either<BaseAppError, EmpresaSalva>> {
    const idValido = this.validator.validateHubspotId(id, "empresa");
    if (idValido.isLeft()) return left(idValido.value);
    const parsed = this.validator.parseEmpresa(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const salva = await this.hubspot.updateCompany(id, toCompanyWrite(parsed.value));
    if (salva.isLeft()) return left(salva.value);
    return right(await this.depoisDeSalvar(salva.value, parsed.value, usuarioId));
  }

  // HubSpot's industry values change rarely: read at most once an hour
  async listarSetores(): Promise<Either<BaseAppError, IndustryOption[]>> {
    if (this.setores && Date.now() - this.setores.em < 60 * 60 * 1000) return right(this.setores.lidos);
    const lidos = await this.hubspot.industryOptions();
    if (lidos.isLeft()) return left(lidos.value);
    this.setores = { lidos: lidos.value, em: Date.now() };
    return right(lidos.value);
  }

  private async depoisDeSalvar(empresa: HubspotCompany, dados: EmpresaInput, usuarioId: string): Promise<EmpresaSalva> {
    this.aoMudar(empresa);
    let aviso: string | null = null;
    try {
      await this.contatos.definirSac(empresa.id, dados.emailSac, usuarioId);
    } catch {
      aviso = "A empresa foi salva no HubSpot, mas o e-mail de SAC não foi gravado. Salve de novo para tentar outra vez.";
    }
    const lida = await this.obter(empresa.id);
    if (lida.isRight()) return { empresa: lida.value, aviso };
    return { empresa: toDetalhe(empresa, dados.emailSac), aviso };
  }
}

export default EmpresaService;
