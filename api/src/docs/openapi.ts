import {
  extendZodWithOpenApi,
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { z, ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import acaoEfetuadaEnum from "../enums/acao_efetuada.enum";
import categoriasNomesEnum from "../enums/categorias_nomes.enum";
import categoriasTiposEnum from "../enums/categorias_tipos.enum";
import permissoesUsuarioEnum from "../enums/usuarios_permissoes.enum";
import { CreateAuditoriaManualSchema, CreateAuditoriaSchema } from "../utils/schemas/auditoria.schema";
import { CreateCategoriaSchema, UpdateCategoriaSchema } from "../utils/schemas/categoria.schema";
import DetalhamentoAuditoriaSchema from "../utils/schemas/detalhamento_auditoria.schema";
import { ClienteSchema, VinculoSchema } from "../utils/schemas/cliente.schema";
import { AlteracaoSchema, PlanoSchema } from "../utils/schemas/pagamento_recorrente.schema";
import { EmpresaSchema } from "../utils/schemas/empresa.schema";
import { AtividadeSchema, EstagioSchema } from "../utils/schemas/atividade.schema";
import { ESTAGIOS } from "../services/hubspot.service";
import { AcaoEmLoteSchema } from "../utils/schemas/produto_lote.schema";
import { CreateProdutoSchema, FilterProdutoSchema, ImportProdutosSchema, UpdateProdutoSchema } from "../utils/schemas/produto.schema";
import {
  CreateUserSchema,
  ForgotPasswordSchema,
  LoginUserSchema,
  RegisterUserSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  UpdateUserSchema,
} from "../utils/schemas/user.schema";

// The API's OpenAPI document, served at /docs and /openapi.json. Request bodies reuse the Zod schemas the
// services validate with; responses are described here, because the DTOs are types and don't exist at runtime.
// /internal/billing is left out on purpose: only the billing service calls it.
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" });

const Erro = registry.register("Erro", z.object({ message: z.string(), status: z.string() }));

const Usuario = registry.register(
  "Usuario",
  z.object({ id: z.string().uuid(), nome: z.string(), email: z.string(), permissoes: permissoesUsuarioEnum, ativo: z.boolean(), trocaSenhaObrigatoria: z.boolean() }),
);
const Sessao = registry.register("Sessao", Usuario.extend({ token: z.string() }));
const Categoria = registry.register(
  "Categoria",
  z.object({ id: z.string().uuid(), nome: categoriasNomesEnum, ativo: z.boolean(), tipo: categoriasTiposEnum }),
);
const Produto = registry.register(
  "Produto",
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    ativo: z.boolean(),
    sku: z.string(),
    categoria: Categoria.pick({ id: true, nome: true, tipo: true }),
    valor_de_custo: z.number(),
    icms: z.number(),
    valor_de_venda: z.number(),
    data_de_cadastro: z.string().datetime(),
    quantidade_em_estoque: z.number().int(),
  }),
);
const Auditoria = registry.register(
  "Auditoria",
  z.object({
    id: z.string().uuid(),
    acao_efetuada: acaoEfetuadaEnum,
    data_de_audicao: z.string().datetime(),
    usuario_id: z.string().uuid(),
    detalhamento_auditoria_id: z.string().uuid().nullable(),
  }),
);
const Detalhamento = registry.register(
  "DetalhamentoAuditoria",
  z.object({
    id: z.string().uuid(),
    nome_do_produto: z.string(),
    valor_anterior: z.string().openapi({ example: "12.50", description: "Decimal, sent as a string" }),
    valor_atual: z.string().openapi({ example: "15.00", description: "Decimal, sent as a string" }),
    observacoes_adicionais: z.string(),
    alteracoes: z.array(z.object({ campo: z.string(), antes: z.string(), depois: z.string() })),
  }),
);
const Importacao = registry.register(
  "Importacao",
  z.object({
    id: z.string().uuid(),
    status: z.enum(["pendente", "processando", "concluida", "rejeitada", "falhou"]),
    nome_arquivo: z.string(),
    total_linhas: z.number().int(),
    linhas_importadas: z.number().int().openapi({ description: "linhas_criadas + linhas_atualizadas; 0 unless concluida" }),
    linhas_criadas: z.number().int(),
    linhas_atualizadas: z.number().int(),
    erros: z.array(z.object({ linha: z.number().int(), campo: z.string(), mensagem: z.string() })),
    mensagem: z.string(),
    criada_em: z.string().datetime().nullable(),
    finalizada_em: z.string().datetime().nullable(),
    tipo: z.enum(["produtos", "clientes", "empresas"]),
    linhas_processadas: z.number().int().openapi({ description: "clientes: rows gone through so far (progress)" }),
    linhas_falharam: z.number().int().openapi({ description: "clientes: rows not saved; page them with /clientes/importacoes/{id}/erros" }),
    empresas_criadas: z.number().int(),
  }),
);
const ImportacaoSincrona = registry.register(
  "ImportacaoSincrona",
  z.object({
    created: z.number().int(),
    updated: z.number().int(),
    errors: z.array(z.object({ linha: z.number().int(), mensagens: z.array(z.string()) })),
  }),
);
const Cliente = registry.register(
  "Cliente",
  z.object({
    id: z.string(),
    nome: z.string(),
    email: z.string().nullable(),
    telefone: z.string().nullable(),
    empresa: z.string().nullable(),
    estagio: z.string().nullable(),
    url: z.string().nullable(),
    cargo: z.string().nullable(),
    senioridade: z.string().nullable(),
    senioridadeOrigem: z.enum(["erp", "hubspot"]).nullable().openapi({ description: "erp: kept in the ERP's database, overriding HubSpot's" }),
    papeis: z.array(z.string()),
    primeiroNome: z.string().nullable(),
    sobrenome: z.string().nullable(),
  }),
);
const Empresa = registry.register(
  "Empresa",
  z.object({
    id: z.string(),
    nome: z.string(),
    dominio: z.string().nullable(),
    setor: z.string().nullable(),
    url: z.string().nullable(),
    total_contatos: z.number().int(),
    total_decisores: z.number().int(),
    contatos: z.array(
      Cliente.omit({ telefone: true, empresa: true, estagio: true }).extend({ posicao: z.number().int() }),
    ).openapi({ description: "The top of the rank, at most 25" }),
  }),
);
const Integracao = registry.register(
  "Integracao",
  z.object({
    provider: z.enum(["jira", "hubspot"]),
    nome: z.string(),
    configurado: z.boolean(),
    conectado: z.boolean(),
    chaveDeServico: z.boolean().openapi({ description: "HubSpot only: the server uses a service key instead of OAuth" }),
    conta: z.record(z.unknown()).optional(),
    config: z.record(z.unknown()).optional(),
    conectadoPor: z.string().nullable().optional(),
    conectadoEm: z.string().datetime().optional(),
  }),
);
const Envio = registry.register(
  "EnvioIntegracao",
  z.object({
    provider: z.string(),
    categoriaNome: z.string(),
    status: z.enum(["pendente", "enviando", "enviada", "erro", "cancelada"]),
    externalId: z.string().nullable(),
    externalUrl: z.string().nullable(),
    tentativas: z.number().int(),
    ultimoErro: z.string().nullable(),
  }),
);
const FilaIntegracao = registry.register(
  "FilaIntegracao",
  z.object({
    enviadas: z.number().int(),
    pendentes: z.number().int(),
    comErro: z.number().int(),
    esgotadas: z.number().int().openapi({ description: "Gave up after maxTentativas; only reenviar brings them back" }),
    erros: z.array(
      z.object({ categoriaNome: z.string(), auditoriaId: z.string(), ultimoErro: z.string().nullable(), tentativas: z.number().int() }),
    ),
    maxTentativas: z.number().int(),
  }),
);
const IssueCriada = registry.register("IssueCriada", z.object({ key: z.string(), url: z.string() }));

const pagina = <T extends ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), pageNumber: z.number().int(), pageSize: z.number().int(), totalItems: z.number().int() });
const um = <T extends ZodTypeAny>(item: T) => z.object({ data: item });
const lista = <T extends ZodTypeAny>(item: T) => z.object({ data: z.array(item) });

// multi-select list filters (utils/schemas/list_filters.schema.ts): repeat the key, ?categoria=A&categoria=B,
// or separate with commas; values of one filter are OR-ed, different filters AND-ed
const multi = <T extends [string, ...string[]]>(values: T, what: string) =>
  z.array(z.enum(values)).optional().openapi({ description: `${what}; repeat for several (any of them matches)` });
const Status = multi(["ativo", "inativo"], "Status");

const Paginacao = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  amount: z.coerce.number().int().min(1).default(20).optional(),
});
const PorId = z.object({ id: z.string().uuid() });
const PorProvider = z.object({ provider: z.enum(["jira", "hubspot"]) });

const ERROS: Record<number, string> = {
  400: "Invalid request",
  401: "Missing, invalid or expired token",
  403: "Requires ADM or SU",
  404: "Not found",
  409: "Conflict with the current state",
  422: "The spreadsheet has invalid lines; nothing was saved",
  503: "An upstream service is unavailable",
};

type Rota = {
  metodo: RouteConfig["method"];
  caminho: string;
  tag: string;
  resumo: string;
  descricao?: string;
  publica?: boolean; // no token
  admin?: boolean; // ADM or SU
  params?: ZodObject<ZodRawShape>;
  query?: ZodObject<ZodRawShape>;
  corpo?: ZodTypeAny;
  arquivo?: boolean; // multipart upload, field "planilha"
  status?: number;
  resposta?: ZodTypeAny; // no schema: an empty response
  extras?: Record<number, ZodTypeAny>;
  erros?: number[];
};

const rota = ({ metodo, caminho, tag, resumo, descricao, publica, admin, params, query, corpo, arquivo, status, resposta, extras, erros = [] }: Rota) => {
  const codigos = new Set([...erros, ...(publica ? [] : [401]), ...(admin ? [403] : []), ...(corpo || arquivo ? [400] : []), ...(params?.shape.id ? [404] : [])]);
  const sucesso = status ?? (metodo === "post" ? 201 : resposta ? 200 : 204);
  registry.registerPath({
    method: metodo,
    path: caminho,
    operationId: `${metodo}${caminho.replace(/[{}]/g, "").replace(/[/-]+(w)/g, (_, letra: string) => letra.toUpperCase())}`,
    tags: [tag],
    summary: resumo,
    description: descricao,
    ...(publica ? { security: [] } : {}),
    request: {
      params,
      query,
      ...(corpo ? { body: { required: true, content: { "application/json": { schema: corpo } } } } : {}),
      ...(arquivo
        ? {
            body: {
              required: true,
              content: { "multipart/form-data": { schema: z.object({ planilha: z.string().openapi({ type: "string", format: "binary" }) }) } },
            },
          }
        : {}),
    },
    responses: {
      [sucesso]: { description: "Success", ...(resposta ? { content: { "application/json": { schema: resposta } } } : {}) },
      ...Object.fromEntries(
        Object.entries(extras ?? {}).map(([codigo, schema]) => [
          codigo,
          { description: ERROS[Number(codigo)] ?? "", content: { "application/json": { schema } } },
        ]),
      ),
      ...Object.fromEntries(
        [...codigos].map((codigo) => [codigo, { description: ERROS[codigo], content: { "application/json": { schema: Erro } } }]),
      ),
    },
  });
};

// ---- usuarios ----
const USUARIOS = "Usuários";
rota({ metodo: "post", caminho: "/user/register", tag: USUARIOS, resumo: "Create your own account", descricao: "Always an active Estoque usuario; permissoes and ativo are ignored.", publica: true, corpo: RegisterUserSchema, resposta: Usuario, erros: [409] });
rota({ metodo: "post", caminho: "/user/login", tag: USUARIOS, resumo: "Log in", publica: true, status: 200, corpo: LoginUserSchema, resposta: Sessao, erros: [401] });
rota({ metodo: "post", caminho: "/user/forgot-password", tag: USUARIOS, resumo: "Ask for a password reset email", descricao: "Answers the same whether the e-mail exists or not.", publica: true, status: 202, corpo: ForgotPasswordSchema, resposta: z.object({ message: z.string() }) });
rota({ metodo: "post", caminho: "/user/reset-password", tag: USUARIOS, resumo: "Set a new password with an emailed token", publica: true, status: 204, corpo: ResetPasswordSchema });
rota({ metodo: "post", caminho: "/user/change-password", tag: USUARIOS, resumo: "Change your own password", descricao: "Ends your other sessions and returns a new one. The only route, with refresh-token, open while trocaSenhaObrigatoria is true; every other one answers 403.", status: 200, corpo: ChangePasswordSchema, resposta: Sessao, erros: [400] });
rota({ metodo: "post", caminho: "/user/refresh-token", tag: USUARIOS, resumo: "Get a new token before this one expires", status: 200, resposta: Sessao });
rota({ metodo: "get", caminho: "/user", tag: USUARIOS, resumo: "List usuarios", query: Paginacao.extend({ permissoes: multi(["ADM", "Estoque", "SU"], "Permissão"), status: Status }), resposta: pagina(Usuario) });
rota({ metodo: "get", caminho: "/user/{id}", tag: USUARIOS, resumo: "Get a usuario", params: PorId, resposta: um(Usuario) });
rota({ metodo: "post", caminho: "/user", tag: USUARIOS, resumo: "Create a usuario", admin: true, corpo: CreateUserSchema, resposta: Usuario, erros: [409] });
rota({ metodo: "put", caminho: "/user/{id}", tag: USUARIOS, resumo: "Update a usuario", descricao: "Changing senha ends that usuario's sessions.", admin: true, params: PorId, corpo: UpdateUserSchema, erros: [409] });
rota({ metodo: "delete", caminho: "/user/{id}", tag: USUARIOS, resumo: "Delete a usuario", admin: true, params: PorId });
rota({ metodo: "patch", caminho: "/user/{id}/archive", tag: USUARIOS, resumo: "Deactivate a usuario", admin: true, params: PorId, resposta: Usuario });

// ---- produtos ----
const PRODUTOS = "Produtos";
const FiltroProdutos = FilterProdutoSchema.merge(Paginacao);
rota({ metodo: "get", caminho: "/products/scroll", tag: PRODUTOS, resumo: "List products for infinite scroll", descricao: "Keyset pagination in name order. Send nextCursor from the previous response as cursor. There is no total, and the first load is cached per session for 30 minutes.", query: z.object({ cursor: z.string().optional(), amount: z.coerce.number().int().min(1).default(30).optional(), categoria: multi(categoriasNomesEnum.options, "Categoria"), icms: z.array(z.number()).optional().openapi({ description: "ICMS rate; repeat for several" }), status: Status.openapi({ description: "ADM/SU only; others see active products whatever this says" }), busca: z.string().max(100).optional().openapi({ description: "Text found anywhere in the name, or in the SKU with busca_por=sku; case-insensitive" }), busca_por: z.enum(["nome", "sku"]).optional().openapi({ description: "Which field busca searches (default nome)" }), cadastro_desde: z.string().datetime({ offset: true }).optional().openapi({ description: "Registered at or after this instant (ISO 8601 with offset); the web sends the user's local midnight" }), cadastro_antes: z.string().datetime({ offset: true }).optional().openapi({ description: "Registered before this instant (exclusive); the web sends the local midnight after the last day" }) }), resposta: z.object({ data: z.array(Produto), pageSize: z.number().int(), nextCursor: z.string().nullable() }), erros: [400] });
rota({ metodo: "get", caminho: "/products/snapshot", tag: PRODUTOS, resumo: "Every visible product as one binary file", descricao: "application/vnd.sample-erp.columnar: the TCC1 columnar format (pkg/tablecore), gzipped when the client accepts it, for the browser's local search engine. Send the ETag back in If-None-Match to get a 304 while nothing changed. X-Snapshot-Rows and X-Snapshot-Bytes describe the file.", status: 200 });
rota({ metodo: "post", caminho: "/products/lote", tag: PRODUTOS, resumo: "Act on several selected products", descricao: "inativar/ativar change the products (ativar: ADM or SU only); favoritar, desfavoritar, salvar_depois and tirar_depois mark them for the signed-in usuario only. alterados counts the products that changed (the others already were that way).", status: 200, corpo: AcaoEmLoteSchema, resposta: um(z.object({ acao: AcaoEmLoteSchema.shape.acao, selecionados: z.number().int(), alterados: z.number().int() })), erros: [403] });
rota({ metodo: "get", caminho: "/products/marcacoes", tag: PRODUTOS, resumo: "Your favourite and saved-for-later products", descricao: "Product ids, newest mark first.", resposta: um(z.object({ favorito: z.array(z.string().uuid()), depois: z.array(z.string().uuid()) })) });
rota({ metodo: "get", caminho: "/products/filter", tag: PRODUTOS, resumo: "Filter products", descricao: "Filters combine with AND. name is a case-insensitive contains.", query: FiltroProdutos, resposta: pagina(Produto), erros: [400] });
rota({ metodo: "get", caminho: "/products/download", tag: PRODUTOS, resumo: "Filtered products with totals, for the spreadsheet", query: FiltroProdutos, resposta: pagina(Produto).extend({ aggregated_value: z.record(z.number()).openapi({ description: "Sum of valor_de_venda per categoria, over every filtered product" }) }), erros: [400] });
rota({ metodo: "post", caminho: "/products/imports", tag: PRODUTOS, resumo: "Queue a spreadsheet import", descricao: "Answers 202 at once. Poll GET /products/imports/{id} until the status is concluida, rejeitada or falhou.", admin: true, arquivo: true, status: 202, resposta: um(Importacao), erros: [503] });
rota({ metodo: "get", caminho: "/products/imports/{id}", tag: PRODUTOS, resumo: "Follow a spreadsheet import", admin: true, params: PorId, resposta: um(Importacao), erros: [503] });
rota({ metodo: "post", caminho: "/products/import", tag: PRODUTOS, resumo: "Import rows already read by the browser", descricao: "Every row is saved or none is.", admin: true, status: 200, corpo: ImportProdutosSchema, resposta: ImportacaoSincrona, extras: { 422: ImportacaoSincrona } });
rota({ metodo: "post", caminho: "/products", tag: PRODUTOS, resumo: "Create a product", corpo: CreateProdutoSchema, resposta: Produto, erros: [409] });
rota({ metodo: "get", caminho: "/products", tag: PRODUTOS, resumo: "List products by page", descricao: "Use /products/scroll for lists: counting the table makes this one slower.", query: Paginacao, resposta: pagina(Produto), erros: [400] });
rota({ metodo: "get", caminho: "/products/{id}", tag: PRODUTOS, resumo: "Get a product", params: PorId, resposta: um(Produto) });
rota({ metodo: "put", caminho: "/products/{id}", tag: PRODUTOS, resumo: "Update a product", descricao: "Records an Alteracao auditoria. The id comes from the URL.", params: PorId, corpo: UpdateProdutoSchema.omit({ id: true }), erros: [409] });
rota({ metodo: "delete", caminho: "/products/{id}", tag: PRODUTOS, resumo: "Delete a product", params: PorId });
rota({ metodo: "patch", caminho: "/products/{id}/deactivate", tag: PRODUTOS, resumo: "Deactivate a product", params: PorId, status: 204 });

// ---- categorias ----
const CATEGORIAS = "Categorias";
rota({ metodo: "post", caminho: "/categorias", tag: CATEGORIAS, resumo: "Create a categoria", corpo: CreateCategoriaSchema, resposta: Categoria, erros: [409] });
rota({ metodo: "get", caminho: "/categorias", tag: CATEGORIAS, resumo: "List categorias", query: Paginacao.extend({ nome: multi(categoriasNomesEnum.options, "Nome"), tipo: multi(["Normal", "Especial", "Personalizado"], "Tipo"), status: Status }), resposta: pagina(Categoria), erros: [400] });
rota({ metodo: "get", caminho: "/categorias/{id}", tag: CATEGORIAS, resumo: "Get a categoria", params: PorId, resposta: um(Categoria) });
rota({ metodo: "put", caminho: "/categorias/{id}", tag: CATEGORIAS, resumo: "Update a categoria", descricao: "The id is read from the body, so send it there too.", params: PorId, corpo: UpdateCategoriaSchema, erros: [409] });
rota({ metodo: "delete", caminho: "/categorias/{id}", tag: CATEGORIAS, resumo: "Delete a categoria", params: PorId });
rota({ metodo: "patch", caminho: "/categorias/{id}/archive", tag: CATEGORIAS, resumo: "Archive a categoria", params: PorId, resposta: z.null() });

// ---- auditorias ----
const AUDITORIAS = "Auditorias";
rota({ metodo: "post", caminho: "/auditoria", tag: AUDITORIAS, resumo: "Create an auditoria", descricao: "The auditor is the signed-in usuario; usuario_id in the body is replaced.", corpo: CreateAuditoriaSchema.omit({ usuario_id: true }), resposta: Auditoria });
rota({ metodo: "post", caminho: "/auditoria/manual", tag: AUDITORIAS, resumo: "Create an auditoria that changes a product or categoria", descricao: "valores is the full record as it should end up. The server diffs it against the stored row, saves both and records every changed field, in one transaction.", corpo: CreateAuditoriaManualSchema.omit({ usuario_id: true }), resposta: Auditoria, erros: [404, 409] });
rota({ metodo: "get", caminho: "/auditoria", tag: AUDITORIAS, resumo: "List auditorias, newest first", descricao: "The first unfiltered load of 30 is cached per session for 30 minutes.", query: Paginacao.extend({ acao: multi(["Criacao", "Alteracao", "Delecao"], "Ação"), auditor: z.array(z.string().uuid()).optional().openapi({ description: "Auditor (usuario id); repeat for several" }) }), resposta: pagina(Auditoria), erros: [400] });
rota({ metodo: "get", caminho: "/auditoria/pendentes", tag: AUDITORIAS, resumo: "Changes waiting to become automatic auditorias", descricao: "Product and categoria changes are queued and consolidated every AUDITORIAS_INTERVALO_MINUTOS (default 5). ultima and proxima are the last and next sweep.", resposta: um(z.object({ total: z.number().int(), desde: z.string().nullable(), ultima: z.string().nullable(), proxima: z.string().nullable(), intervaloMinutos: z.number().int() })) });
rota({ metodo: "post", caminho: "/auditoria/pendentes/consolidar", tag: AUDITORIAS, resumo: "Consolidate the pending changes now", descricao: "Runs the sweep without waiting for the timer (joins one already running).", status: 200, resposta: um(z.object({ pendentes: z.number().int(), auditorias: z.number().int(), lotes: z.number().int() })) });
rota({ metodo: "get", caminho: "/auditoria/{id}", tag: AUDITORIAS, resumo: "Get an auditoria", params: PorId, resposta: um(Auditoria) });
rota({ metodo: "put", caminho: "/auditoria/{id}", tag: AUDITORIAS, resumo: "Update an auditoria", descricao: "Changes acao_efetuada and data_de_audicao only. The whole body is still validated.", params: PorId, corpo: CreateAuditoriaSchema.omit({ usuario_id: true }) });
rota({ metodo: "delete", caminho: "/auditoria/{id}", tag: AUDITORIAS, resumo: "Delete an auditoria", params: PorId });
rota({ metodo: "patch", caminho: "/auditoria/{id}/archive", tag: AUDITORIAS, resumo: "Archive an auditoria", params: PorId, resposta: z.null() });

const DETALHAMENTOS = "Detalhamentos de auditoria";
rota({ metodo: "post", caminho: "/detalhamento-auditoria", tag: DETALHAMENTOS, resumo: "Create a detalhamento", corpo: DetalhamentoAuditoriaSchema.omit({ id: true }), resposta: Detalhamento });
rota({ metodo: "get", caminho: "/detalhamento-auditoria", tag: DETALHAMENTOS, resumo: "List detalhamentos", query: Paginacao, resposta: pagina(Detalhamento), erros: [400] });
rota({ metodo: "get", caminho: "/detalhamento-auditoria/{id}", tag: DETALHAMENTOS, resumo: "Get a detalhamento", params: PorId, resposta: um(Detalhamento) });
rota({ metodo: "put", caminho: "/detalhamento-auditoria/{id}", tag: DETALHAMENTOS, resumo: "Update a detalhamento", descricao: "The id is read from the body, so send it there too.", params: PorId, corpo: DetalhamentoAuditoriaSchema });
rota({ metodo: "delete", caminho: "/detalhamento-auditoria/{id}", tag: DETALHAMENTOS, resumo: "Delete a detalhamento", params: PorId });

// ---- clientes ----
const CLIENTES = "Clientes";
const BuscaClientes = z.object({ page: Paginacao.shape.page, amount: z.coerce.number().int().min(1).max(100).default(20).optional(), busca: z.string().optional() });
rota({ metodo: "get", caminho: "/clientes", tag: CLIENTES, resumo: "List HubSpot contacts", descricao: "Read live from HubSpot; the first load of 30 is cached per session for 30 minutes.", admin: true, query: BuscaClientes, resposta: pagina(Cliente), erros: [409, 503] });
rota({ metodo: "get", caminho: "/clientes/empresas", tag: CLIENTES, resumo: "List HubSpot companies with their contacts ranked", descricao: "Decision makers first, then seniority, then name.", admin: true, query: BuscaClientes.extend({ decisores: z.enum(["true", "false"]).optional() }), resposta: pagina(Empresa).extend({ sem_empresa: z.number().int() }), erros: [409, 503] });
const PorContato = z.object({ id: z.string().regex(/^\d+$/) });
const ClienteSalvo = um(Cliente).extend({ aviso: z.string().nullable().openapi({ description: "Saved in HubSpot, but the ERP's senioridade wasn't" }) });
rota({ metodo: "post", caminho: "/clientes/importacoes", tag: CLIENTES, resumo: "Queue a clients spreadsheet", descricao: "Up to 500,000 rows, done by the Go importer (contacts upserted in HubSpot by e-mail, in batches of 100). Answers 202; poll GET /clientes/importacoes/{id}.", admin: true, arquivo: true, status: 202, resposta: um(Importacao), erros: [503] });
rota({ metodo: "get", caminho: "/clientes/importacoes/{id}", tag: CLIENTES, resumo: "Follow a clients import", admin: true, params: PorId, resposta: um(Importacao), erros: [503] });
rota({ metodo: "get", caminho: "/clientes/importacoes/{id}/erros", tag: CLIENTES, resumo: "Failed rows of a clients import", descricao: "Ordered by seq; pass ?depois=<last seq you have> to get only the new ones. proximo is the seq to continue from, or null when there are no more.", admin: true, params: PorId, query: z.object({ depois: z.coerce.number().int().optional(), limite: z.coerce.number().int().max(5000).optional() }), resposta: z.object({ data: z.array(z.object({ seq: z.number().int(), linha: z.number().int(), campo: z.string(), email: z.string(), mensagem: z.string() })), proximo: z.number().int().nullable() }), erros: [503] });
rota({ metodo: "post", caminho: "/clientes/empresas/importacoes", tag: CLIENTES, resumo: "Queue a companies spreadsheet", descricao: "Columns Nome (required), Domínio, Setor (HubSpot industry value or label), Telefone, Site, Cidade, Estado, País, Descrição, E-mail SAC. Done by the Go importer: each company is found in HubSpot by name and updated (empty cells keep what HubSpot has) or created; the SAC e-mail is kept in the ERP. Answers 202; poll GET /clientes/empresas/importacoes/{id}.", admin: true, arquivo: true, status: 202, resposta: um(Importacao), erros: [503] });
rota({ metodo: "get", caminho: "/clientes/empresas/importacoes/{id}", tag: CLIENTES, resumo: "Follow a companies import", admin: true, params: PorId, resposta: um(Importacao), erros: [503] });
rota({ metodo: "get", caminho: "/clientes/empresas/importacoes/{id}/erros", tag: CLIENTES, resumo: "Failed rows of a companies import (email holds the company name)", descricao: "Ordered by seq; pass ?depois=<last seq you have> to get only the new ones. proximo is the seq to continue from, or null when there are no more.", admin: true, params: PorId, query: z.object({ depois: z.coerce.number().int().optional(), limite: z.coerce.number().int().max(5000).optional() }), resposta: z.object({ data: z.array(z.object({ seq: z.number().int(), linha: z.number().int(), campo: z.string(), email: z.string(), mensagem: z.string() })), proximo: z.number().int().nullable() }), erros: [503] });
const PorEmpresa = z.object({ id: z.string().regex(/^\d+$/) });
const Estagio = z.enum(ESTAGIOS).openapi({ description: "Funil column (HubSpot lifecyclestage; subscriber/other/empty are nao_contatado)" });
const EmpresaDetalhe = registry.register(
  "EmpresaDetalhe",
  z.object({ id: z.string(), nome: z.string(), dominio: z.string().nullable(), setor: z.string().nullable(), telefone: z.string().nullable(), cidade: z.string().nullable(), estado: z.string().nullable(), pais: z.string().nullable(), site: z.string().nullable(), descricao: z.string().nullable(), emailSac: z.string().nullable().openapi({ description: "Kept in the ERP: copied on the e-mails about a client's failed payment" }), responsavelId: z.string().nullable().openapi({ description: "HubSpot owner (hubspot_owner_id)" }), estagio: Estagio, url: z.string().nullable() }),
);
const EmpresaSalva = um(EmpresaDetalhe).extend({ aviso: z.string().nullable().openapi({ description: "Saved in HubSpot, but the ERP's SAC e-mail wasn't" }) });
rota({ metodo: "get", caminho: "/clientes/empresas/setores", tag: CLIENTES, resumo: "HubSpot's industry options", descricao: "The values setor accepts; cached for an hour.", admin: true, resposta: lista(z.object({ value: z.string(), label: z.string() })), erros: [409, 503] });
rota({ metodo: "get", caminho: "/clientes/empresas/responsaveis", tag: CLIENTES, resumo: "HubSpot users a company can be assigned to", descricao: "Cached for 5 minutes.", admin: true, resposta: lista(z.object({ id: z.string(), nome: z.string(), email: z.string().nullable() })), erros: [409, 503] });
rota({ metodo: "post", caminho: "/clientes/empresas", tag: CLIENTES, resumo: "Create a company", descricao: "Created in HubSpot (409 when one with this name exists); emailSac is kept in the ERP.", admin: true, status: 201, corpo: EmpresaSchema, resposta: EmpresaSalva, erros: [409, 503] });
rota({ metodo: "get", caminho: "/clientes/empresas/{id}", tag: CLIENTES, resumo: "Get a company", admin: true, params: PorEmpresa, resposta: um(EmpresaDetalhe), erros: [409, 503] });
rota({ metodo: "put", caminho: "/clientes/empresas/{id}", tag: CLIENTES, resumo: "Edit a company", descricao: "Empty fields clear the HubSpot property; responsavelId absent keeps the owner, null clears it.", admin: true, params: PorEmpresa, corpo: EmpresaSchema, resposta: EmpresaSalva, erros: [409, 503] });
rota({ metodo: "put", caminho: "/clientes/empresas/{id}/estagio", tag: CLIENTES, resumo: "Move a company to another Funil column", admin: true, params: PorEmpresa, corpo: EstagioSchema, erros: [409, 503] });
rota({ metodo: "get", caminho: "/clientes/funil", tag: CLIENTES, resumo: "One Funil column", descricao: "The companies in one stage, newest change first, 25 per page; pass proxima back as after for the next page.", admin: true, query: z.object({ estagio: Estagio, after: z.string().optional(), busca: z.string().max(100).optional() }), resposta: z.object({ data: z.array(z.object({ id: z.string(), nome: z.string(), dominio: z.string().nullable(), cidade: z.string().nullable(), estado: z.string().nullable(), setor: z.string().nullable(), responsavelId: z.string().nullable(), estagio: Estagio })), total: z.number().int(), proxima: z.string().nullable(), estagios: z.array(Estagio) }), erros: [400, 409, 503] });
rota({ metodo: "post", caminho: "/clientes/atividades", tag: CLIENTES, resumo: "Log a note, e-mail or meeting", descricao: "Goes to the HubSpot timeline of the client (and its company) or of the company. An e-mail goes to a client and, unless enviar is false, is also sent to them through Resend; emailEnviado and aviso say how that went.", admin: true, status: 201, corpo: AtividadeSchema, resposta: um(z.object({ id: z.string(), tipo: z.enum(["nota", "email", "reuniao"]), emailEnviado: z.boolean().nullable(), aviso: z.string().nullable() })), erros: [404, 409, 503] });
rota({ metodo: "get", caminho: "/clientes/empresas/{id}/clientes", tag: CLIENTES, resumo: "List a company's clients", admin: true, params: PorEmpresa, resposta: z.object({ data: z.array(Cliente) }), erros: [409, 503] });
rota({ metodo: "post", caminho: "/clientes/empresas/{id}/clientes", tag: CLIENTES, resumo: "Link existing clients to a company", descricao: "For clients registered before their company: each one leaves its other companies, is linked here (primary) and gets the company name. Up to 100 per call; per-client failures come back in falhas.", admin: true, params: PorEmpresa, corpo: VinculoSchema, resposta: z.object({ data: z.object({ vinculados: z.array(z.string()), falhas: z.array(z.object({ clienteId: z.string(), mensagem: z.string() })) }) }), erros: [404, 409, 503] });
rota({ metodo: "get", caminho: "/clientes/{id}", tag: CLIENTES, resumo: "Get a HubSpot contact", admin: true, params: PorContato, resposta: um(Cliente), erros: [409, 503] });
rota({ metodo: "post", caminho: "/clientes", tag: CLIENTES, resumo: "Create a client", descricao: "Created as a HubSpot contact; senioridade is kept in the ERP (null or absent: none).", admin: true, status: 201, corpo: ClienteSchema, resposta: ClienteSalvo, erros: [409, 503] });
rota({ metodo: "put", caminho: "/clientes/{id}", tag: CLIENTES, resumo: "Edit a client", descricao: "Written to the HubSpot contact; senioridade: absent keeps the ERP's, null clears it (HubSpot's shows again).", admin: true, params: PorContato, corpo: ClienteSchema, resposta: ClienteSalvo, erros: [409, 503] });

// ---- integracoes ----
const INTEGRACOES = "Integrações";
rota({ metodo: "get", caminho: "/integracoes/{provider}/callback", tag: INTEGRACOES, resumo: "OAuth callback", descricao: "The provider redirects the browser here; it always ends in a 302 to the web app.", publica: true, params: PorProvider, status: 302 });
rota({ metodo: "get", caminho: "/integracoes/auditorias/{auditoriaId}", tag: INTEGRACOES, resumo: "Issues and tickets of an auditoria", params: z.object({ auditoriaId: z.string().uuid() }), resposta: lista(Envio) });
rota({ metodo: "get", caminho: "/integracoes", tag: INTEGRACOES, resumo: "List integrations", admin: true, resposta: lista(Integracao) });
rota({ metodo: "get", caminho: "/integracoes/jira/projetos", tag: INTEGRACOES, resumo: "List Jira projects", admin: true, resposta: lista(z.object({ key: z.string(), name: z.string(), issueTypes: z.array(z.object({ id: z.string(), name: z.string() })) })), erros: [409, 503] });
rota({ metodo: "put", caminho: "/integracoes/jira/config", tag: INTEGRACOES, resumo: "Choose the Jira project and issue type", admin: true, corpo: z.object({ projectKey: z.string(), issueTypeId: z.string() }), resposta: um(z.record(z.unknown())), erros: [409, 503] });
rota({ metodo: "post", caminho: "/integracoes/jira/teste", tag: INTEGRACOES, resumo: "Create a test Jira issue", admin: true, resposta: IssueCriada, erros: [409, 503] });
rota({ metodo: "get", caminho: "/integracoes/hubspot/pipelines", tag: INTEGRACOES, resumo: "List HubSpot ticket pipelines", admin: true, resposta: lista(z.object({ id: z.string(), label: z.string(), stages: z.array(z.object({ id: z.string(), label: z.string() })) })), erros: [409, 503] });
rota({ metodo: "put", caminho: "/integracoes/hubspot/config", tag: INTEGRACOES, resumo: "Choose the HubSpot pipeline and status", admin: true, corpo: z.object({ pipelineId: z.string(), stageId: z.string() }), resposta: um(z.object({ pipelineId: z.string(), pipelineName: z.string(), stageId: z.string(), stageName: z.string() })), erros: [409, 503] });
rota({ metodo: "post", caminho: "/integracoes/hubspot/teste", tag: INTEGRACOES, resumo: "Create a test HubSpot ticket", admin: true, resposta: IssueCriada, erros: [409, 503] });
rota({ metodo: "get", caminho: "/integracoes/{provider}/fila", tag: INTEGRACOES, resumo: "Sending queue of an integration", admin: true, params: PorProvider, resposta: um(FilaIntegracao), erros: [404] });
rota({ metodo: "post", caminho: "/integracoes/{provider}/fila/reenviar", tag: INTEGRACOES, resumo: "Send again what gave up", admin: true, params: PorProvider, status: 202, resposta: z.object({ reenviadas: z.number().int() }), erros: [404] });
rota({ metodo: "get", caminho: "/integracoes/{provider}/authorize", tag: INTEGRACOES, resumo: "Get the OAuth consent URL", descricao: "JSON, not a redirect: the web app opens the URL itself.", admin: true, params: PorProvider, resposta: z.object({ url: z.string().url() }), erros: [400, 409] });
rota({ metodo: "delete", caminho: "/integracoes/{provider}", tag: INTEGRACOES, resumo: "Disconnect an integration", admin: true, params: PorProvider, erros: [400] });

rota({ metodo: "get", caminho: "/integracoes/stripe", tag: INTEGRACOES, resumo: "Stripe connection and latest events", descricao: "Asked of Stripe live through the billing service (BILLING_URL). Always 200: configurado/alcancavel/status.conectado say what is missing.", admin: true, query: z.object({ limite: z.coerce.number().int().min(1).max(50).optional() }), resposta: z.object({ configurado: z.boolean(), alcancavel: z.boolean(), status: z.object({ conectado: z.boolean(), conta: z.object({ id: z.string(), nome: z.string().nullable(), pais: z.string().nullable(), moeda: z.string().nullable(), cobrancasAtivas: z.boolean() }).nullable(), modoTeste: z.boolean(), webhookConfigurado: z.boolean(), erro: z.string().nullable() }).nullable(), eventos: z.array(z.object({ id: z.string(), tipo: z.string(), criadoEm: z.string(), producao: z.boolean(), resumo: z.string().nullable() })), erro: z.string().nullable() }) });

const COBRANCAS = "Cobranças";
rota({ metodo: "post", caminho: "/cobrancas", tag: COBRANCAS, resumo: "Bill one or more HubSpot contacts", descricao: "One Stripe invoice per contact (read live from HubSpot), its payment link e-mailed to the contact through Resend, and a summary to the issuer. The Idempotency-Key makes a retry bill and mail nobody twice.", admin: true, status: 201, corpo: z.object({ clienteIds: z.array(z.string()).min(1).max(50), descricao: z.string().max(200), valor: z.number().min(1), vencimentoDias: z.number().int().min(1).max(60).optional(), cc: z.array(z.string().email()).max(10).optional(), cco: z.array(z.string().email()).max(10).optional() }), resposta: um(z.object({ resultados: z.array(z.object({ clienteId: z.string(), nome: z.string(), email: z.string().nullable(), ok: z.boolean(), numero: z.string().nullable(), url: z.string().nullable(), vencimento: z.string().nullable(), erro: z.string().nullable(), emailEnviado: z.boolean(), semCopias: z.boolean().optional().openapi({ description: "The mail provider refused the Cc/Cco (e.g. Resend test mode), so it went to the client only" }) })), emissorNotificado: z.boolean(), erroEmailEmissor: z.string().nullable() })), erros: [400, 503] });
rota({ metodo: "get", caminho: "/cobrancas", tag: COBRANCAS, resumo: "Latest cobranças", descricao: "The 30 newest invoices this ERP issued, from Stripe.", admin: true, resposta: lista(z.object({ id: z.string(), numero: z.string().nullable(), status: z.string(), clienteNome: z.string().nullable(), clienteEmail: z.string().nullable(), valorCentavos: z.number(), pagoCentavos: z.number(), criadaEm: z.string(), vencimento: z.string().nullable(), url: z.string().nullable(), emissor: z.string().nullable() })), erros: [503] });
const LinhaDoTempo = z.object({ rodando: z.boolean(), iniciadaEm: z.string().nullable(), terminadaEm: z.string().nullable(), faturas: z.number().int(), notas: z.number().int(), pagas: z.number().int(), semCliente: z.number().int(), erros: z.array(z.string()), whatsappConfigurado: z.boolean() });
rota({ metodo: "get", caminho: "/cobrancas/linha-do-tempo", tag: COBRANCAS, resumo: "Progress of the HubSpot timeline backfill", admin: true, resposta: um(LinhaDoTempo) });
rota({ metodo: "post", caminho: "/cobrancas/linha-do-tempo/sincronizar", tag: COBRANCAS, resumo: "Give every issued invoice its HubSpot timeline note", descricao: "Runs in the background (joins one already running); paid invoices also move the client to customer. Poll GET /cobrancas/linha-do-tempo.", admin: true, status: 202, resposta: um(LinhaDoTempo) });
const Ciclo = z.object({ ciclo: z.number().int(), dataReferencia: z.string(), valorCentavos: z.number().int(), status: z.enum(["emitida", "falhou", "pulado"]), faturaId: z.string().nullable(), faturaNumero: z.string().nullable(), faturaUrl: z.string().nullable(), vencimento: z.string().nullable(), emailEnviado: z.boolean(), erro: z.string().nullable(), criadoEm: z.string() });
const PagamentoMensal = registry.register(
  "PagamentoMensal",
  z.object({
    id: z.string().uuid(),
    hubspotContatoId: z.string(),
    descricao: z.string(),
    valorCentavos: z.number().int(),
    valorMaximoCentavos: z.number().int(),
    valorMinimoCentavos: z.number().int().nullable(),
    intervalo: z.number().int(),
    unidade: z.enum(["dias", "meses"]),
    vencimentoDias: z.number().int(),
    dataInicio: z.string(),
    dataFim: z.string().nullable(),
    proximoCiclo: z.number().int(),
    proximaData: z.string(),
    status: z.enum(["ativo", "pausado", "encerrado", "cancelado"]),
    tentativas: z.number().int(),
    ultimoErro: z.string().nullable(),
    cliente: z.object({ id: z.string(), nome: z.string(), email: z.string().nullable(), url: z.string().nullable() }).nullable(),
    ciclos: z.array(Ciclo),
  }),
);
const RECORRENTES = "/cobrancas/recorrentes";
rota({ metodo: "get", caminho: RECORRENTES, tag: COBRANCAS, resumo: "List recurring payments (Pagamento mensal)", admin: true, query: z.object({ clienteId: z.string().optional() }), resposta: lista(PagamentoMensal), erros: [503] });
rota({ metodo: "post", caminho: RECORRENTES, tag: COBRANCAS, resumo: "Create a recurring payment", descricao: "Charges valor (reais) every intervalo dias/meses from dataInicio, never above valorMaximo nor below valorMinimo. Each cycle is a Stripe invoice e-mailed to the client.", admin: true, status: 201, corpo: PlanoSchema, resposta: um(PagamentoMensal), erros: [422, 503] });
rota({ metodo: "get", caminho: `${RECORRENTES}/{id}`, tag: COBRANCAS, resumo: "Get a recurring payment and its cycles", admin: true, params: PorId, resposta: um(PagamentoMensal) });
rota({ metodo: "put", caminho: `${RECORRENTES}/{id}`, tag: COBRANCAS, resumo: "Change a recurring payment", descricao: "From the next cycle on; the client, frequency and start can't change.", admin: true, params: PorId, corpo: AlteracaoSchema, resposta: um(PagamentoMensal), erros: [409] });
for (const [acao, resumo] of [["pausar", "Pause"], ["retomar", "Resume (from the first date not yet past)"], ["cancelar", "Cancel"]] as const) {
  rota({ metodo: "post", caminho: `${RECORRENTES}/{id}/${acao}`, tag: COBRANCAS, resumo: `${resumo} a recurring payment`, admin: true, params: PorId, resposta: um(PagamentoMensal), erros: [409] });
}

// ---- telemetria ----
const TELEMETRIA = "Telemetria";
rota({ metodo: "post", caminho: "/telemetry", tag: TELEMETRIA, resumo: "Send a batch of web telemetry events", descricao: "Timings and sizes from the web's telemetry bus (which thread ran a search or parsed a page, long animation frames), kept as ML training data: never row data nor typed text. Always 204; the X-Telemetry header says stored or dropped (TELEMETRY_DIR unset).", status: 204, corpo: z.array(z.object({ source: z.string().min(1).max(64), type: z.string().min(1).max(64), ts: z.number(), data: z.record(z.string(), z.unknown()) })).min(1).max(200) });

export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: "3.1.0",
  info: {
    title: "sample-ERP API",
    version: "1.0.0",
    description: "Inventory and audit ERP. Log in with POST /user/login and use the token with Authorize. Every error has the Erro shape.",
  },
  servers: [{ url: "/" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: USUARIOS, description: "Accounts, login and password reset. Permissions: Estoque < ADM < SU." },
    { name: PRODUTOS, description: "Products and spreadsheet imports. ADM and SU also see inactive products." },
    { name: CATEGORIAS, description: "Product categorias." },
    { name: AUDITORIAS, description: "The record of what changed. New auditorias also become Jira issues or HubSpot tickets." },
    { name: DETALHAMENTOS, description: "The before and after of an auditoria." },
    { name: CLIENTES, description: "HubSpot contacts and companies, read live. ADM and SU only." },
    { name: INTEGRACOES, description: "Jira and HubSpot connections and their sending queues." },
    { name: COBRANCAS, description: "Stripe invoices for HubSpot contacts (through the billing service) and recurring payments. ADM and SU only." },
    { name: TELEMETRIA, description: "Web performance events." },
  ],
});
