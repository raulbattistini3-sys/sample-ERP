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
import { CreateProdutoSchema, FilterProdutoSchema, ImportProdutosSchema, UpdateProdutoSchema } from "../utils/schemas/produto.schema";
import {
  CreateUserSchema,
  ForgotPasswordSchema,
  LoginUserSchema,
  RegisterUserSchema,
  ResetPasswordSchema,
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
  z.object({ id: z.string().uuid(), nome: z.string(), email: z.string(), permissoes: permissoesUsuarioEnum, ativo: z.boolean() }),
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
    papeis: z.array(z.string()),
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
rota({ metodo: "post", caminho: "/user/refresh-token", tag: USUARIOS, resumo: "Get a new token before this one expires", status: 200, resposta: Sessao });
rota({ metodo: "get", caminho: "/user", tag: USUARIOS, resumo: "List usuarios", query: Paginacao, resposta: pagina(Usuario) });
rota({ metodo: "get", caminho: "/user/{id}", tag: USUARIOS, resumo: "Get a usuario", params: PorId, resposta: um(Usuario) });
rota({ metodo: "post", caminho: "/user", tag: USUARIOS, resumo: "Create a usuario", admin: true, corpo: CreateUserSchema, resposta: Usuario, erros: [409] });
rota({ metodo: "put", caminho: "/user/{id}", tag: USUARIOS, resumo: "Update a usuario", descricao: "Changing senha ends that usuario's sessions.", admin: true, params: PorId, corpo: UpdateUserSchema, erros: [409] });
rota({ metodo: "delete", caminho: "/user/{id}", tag: USUARIOS, resumo: "Delete a usuario", admin: true, params: PorId });
rota({ metodo: "patch", caminho: "/user/{id}/archive", tag: USUARIOS, resumo: "Deactivate a usuario", admin: true, params: PorId, resposta: Usuario });

// ---- produtos ----
const PRODUTOS = "Produtos";
const FiltroProdutos = FilterProdutoSchema.merge(Paginacao);
rota({ metodo: "get", caminho: "/products/scroll", tag: PRODUTOS, resumo: "List products for infinite scroll", descricao: "Keyset pagination in name order. Send nextCursor from the previous response as cursor. There is no total, and the first load is cached per session for 30 minutes.", query: z.object({ cursor: z.string().optional(), amount: z.coerce.number().int().min(1).default(30).optional() }), resposta: z.object({ data: z.array(Produto), pageSize: z.number().int(), nextCursor: z.string().nullable() }), erros: [400] });
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
rota({ metodo: "get", caminho: "/categorias", tag: CATEGORIAS, resumo: "List categorias", query: Paginacao, resposta: pagina(Categoria), erros: [400] });
rota({ metodo: "get", caminho: "/categorias/{id}", tag: CATEGORIAS, resumo: "Get a categoria", params: PorId, resposta: um(Categoria) });
rota({ metodo: "put", caminho: "/categorias/{id}", tag: CATEGORIAS, resumo: "Update a categoria", descricao: "The id is read from the body, so send it there too.", params: PorId, corpo: UpdateCategoriaSchema, erros: [409] });
rota({ metodo: "delete", caminho: "/categorias/{id}", tag: CATEGORIAS, resumo: "Delete a categoria", params: PorId });
rota({ metodo: "patch", caminho: "/categorias/{id}/archive", tag: CATEGORIAS, resumo: "Archive a categoria", params: PorId, resposta: z.null() });

// ---- auditorias ----
const AUDITORIAS = "Auditorias";
rota({ metodo: "post", caminho: "/auditoria", tag: AUDITORIAS, resumo: "Create an auditoria", descricao: "The auditor is the signed-in usuario; usuario_id in the body is replaced.", corpo: CreateAuditoriaSchema.omit({ usuario_id: true }), resposta: Auditoria });
rota({ metodo: "post", caminho: "/auditoria/manual", tag: AUDITORIAS, resumo: "Create an auditoria that changes a product or categoria", descricao: "valores is the full record as it should end up. The server diffs it against the stored row, saves both and records every changed field, in one transaction.", corpo: CreateAuditoriaManualSchema.omit({ usuario_id: true }), resposta: Auditoria, erros: [404, 409] });
rota({ metodo: "get", caminho: "/auditoria", tag: AUDITORIAS, resumo: "List auditorias, newest first", descricao: "The first load of 30 is cached per session for 30 minutes.", query: Paginacao, resposta: pagina(Auditoria), erros: [400] });
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
  ],
});
