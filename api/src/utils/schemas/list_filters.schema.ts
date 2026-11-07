import acaoEfetuadaEnum from "../../enums/acao_efetuada.enum";
import categoriasNomesEnum from "../../enums/categorias_nomes.enum";
import categoriasTiposEnum from "../../enums/categorias_tipos.enum";
import permissoesUsuarioEnum from "../../enums/usuarios_permissoes.enum";
import { STATUS_VALUES } from "../helpers/list_filters";

// The multi-select filters each list accepts (utils/helpers/list_filters.ts parses them).

export const PRODUTO_FILTERS = {
   categoria: { label: "categoria", values: categoriasNomesEnum.options },
   icms: { label: "ICMS", kind: "number" },
   // only ADM/SU see inactive products; for anyone else "inativo" matches nothing
   status: { label: "status", values: STATUS_VALUES },
   // the search bar: text found anywhere in the name (default) or in the SKU, case-insensitive
   busca: { label: "busca", kind: "text" },
   busca_por: { label: "busca por", values: ["nome", "sku"] },
   // the registration period [desde, antes), as instants: the web sends the user's local midnights, so the
   // days are the user's, whatever the server's time zone
   cadastro_desde: { label: "cadastro (desde)", kind: "instant" },
   cadastro_antes: { label: "cadastro (antes de)", kind: "instant" },
} as const;

export const CATEGORIA_FILTERS = {
   nome: { label: "nome", values: categoriasNomesEnum.options },
   tipo: { label: "tipo", values: categoriasTiposEnum.options },
   status: { label: "status", values: STATUS_VALUES },
} as const;

export const USUARIO_FILTERS = {
   permissoes: { label: "permissão", values: permissoesUsuarioEnum.options },
   status: { label: "status", values: STATUS_VALUES },
} as const;

export const AUDITORIA_FILTERS = {
   acao: { label: "ação", values: acaoEfetuadaEnum.options },
   auditor: { label: "auditor", kind: "uuid" },
} as const;

export type ProdutoFilters = Partial<Record<keyof typeof PRODUTO_FILTERS, string[]>>;
export type CategoriaFilters = Partial<Record<keyof typeof CATEGORIA_FILTERS, string[]>>;
export type UsuarioFilters = Partial<Record<keyof typeof USUARIO_FILTERS, string[]>>;
export type AuditoriaFilters = Partial<Record<keyof typeof AUDITORIA_FILTERS, string[]>>;
