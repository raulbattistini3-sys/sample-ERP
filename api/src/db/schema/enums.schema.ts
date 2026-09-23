import { mysqlEnum } from "drizzle-orm/mysql-core";
import permissoesUsuarioEnum from "../../enums/usuarios_permissoes.enum";
import categoriasNomesEnum from "../../enums/categorias_nomes.enum";
import categoriasTiposEnum from "../../enums/categorias_tipos.enum";
import acaoEfetuadaEnum from "../../enums/acao_efetuada.enum";

export const permissoesUsuarioMysqlEnum = (name: string) =>
  mysqlEnum(name, permissoesUsuarioEnum.options as [string, ...string[]]);
export const categoriasNomesMysqlEnum = (name: string) =>
  mysqlEnum(name, categoriasNomesEnum.options as [string, ...string[]]);
export const categoriasTiposMysqlEnum = (name: string) =>
  mysqlEnum(name, categoriasTiposEnum.options as [string, ...string[]]);
export const acaoEfetuadaMysqlEnum = (name: string) =>
  mysqlEnum(name, acaoEfetuadaEnum.options as [string, ...string[]]);
