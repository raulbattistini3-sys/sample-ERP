import { toCsv } from "../../../lib/csv";

// The columns of the client spreadsheet: the same fields as the "Novo cliente" form. The importer
// (importer/importacao/clientes.go) matches them by header, in any order, ignoring case and accents, and
// ignores unknown columns. Only E-mail and Nome are required.
export const COLUNAS = ["Nome", "Sobrenome", "E-mail", "Telefone", "Empresa", "Cargo", "Senioridade", "Decisor"] as const;

export const MAX_CLIENTES_IMPORTACAO = 500_000;
// the API's upload limit (MAX_CLIENTES_IMPORT_FILE_MB); checked here so a huge file isn't sent for nothing
export const MAX_PLANILHA_CLIENTES_MB = 120;

export const modeloCsv = () =>
  toCsv([
    [...COLUNAS],
    ["Ana", "Souza", "ana.souza@acme.com.br", "+55 11 91234-5678", "Acme", "Diretora de Compras", "Diretor", "Sim"],
    ["Bruno", "Lima", "bruno@acme.com.br", "", "Acme", "Analista", "", "Não"],
  ]);
