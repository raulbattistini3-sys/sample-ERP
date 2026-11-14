import { toCsv } from "../../../lib/csv";

// The columns of the companies spreadsheet: the same fields as the "Nova empresa" page. The importer
// (importer/importacao/empresas.go) matches them by header, in any order, ignoring case and accents, and
// ignores unknown columns. Only Nome is required; it identifies the company (an existing one is updated, and
// its empty cells keep what HubSpot has). Setor takes the HubSpot industry label or code.
export const COLUNAS_EMPRESAS = [
  "Nome",
  "Domínio",
  "Setor",
  "Telefone",
  "Site",
  "Cidade",
  "Estado",
  "País",
  "Descrição",
  "E-mail SAC",
] as const;

export const modeloEmpresasCsv = () =>
  toCsv([
    [...COLUNAS_EMPRESAS],
    [
      "Acme",
      "acme.com.br",
      "Computer Software",
      "+55 11 3456-7890",
      "https://www.acme.com.br",
      "São Paulo",
      "SP",
      "Brasil",
      "Distribuidora de peças industriais",
      "sac@acme.com.br",
    ],
    ["Beta Logística", "", "", "", "", "Curitiba", "PR", "Brasil", "", ""],
  ]);
