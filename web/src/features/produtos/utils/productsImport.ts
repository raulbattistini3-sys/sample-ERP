import { toCsv } from "../../../lib/csv";
import { SpreadsheetRow } from "../../../lib/spreadsheet";
import { CategoriaNomesEnum } from "../../categoria/types/categoria.types";

// Columns are read by position, in this order (the same as "Baixar planilha", so an exported file
// can be edited and imported back). Anything after the 7th column (Status, Data de cadastro) is ignored.
export const IMPORT_COLUMNS = [
  "SKU",
  "Nome",
  "Categoria",
  "Valor de custo (R$)",
  "ICMS (%)",
  "Valor de venda (R$)",
  "Estoque",
] as const;

// where the export's totals section starts; reading stops there
const TOTALS_MARKER = "total de venda por categoria";

export type ImportRow = {
  linha: number; // the row number shown by Excel (1-based, header included)
  sku: string;
  name: string;
  categoria: { nome: string };
  valor_de_custo: number;
  icms?: number;
  valor_de_venda?: number;
  quantidade_em_estoque: number;
};

export type ImportRowError = { linha: number; mensagens: string[] };

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

// numbers as typed in a pt-BR or en spreadsheet: 4090 | 4090,5 | 4.090,50 | 4,090.50 | R$ 4.090,50 | 17,5%
export function parseNumberCell(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = text(value).replace(/R\$|%|\s/g, "");
  if (raw === "") return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // the later separator is the decimal one
    raw = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma > -1) {
    raw = raw.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, ""); // 4.090 = four thousand and ninety
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// Rows -> products, in column order. The first row is skipped when it's the header (first cell "SKU");
// blank rows are skipped; the export's totals section ends the data.
export function rowsToImport(rows: SpreadsheetRow[]): { items: ImportRow[]; errors: ImportRowError[] } {
  const items: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const firstLineBySku = new Map<string, number>();

  for (let index = 0; index < rows.length; index++) {
    const cells = rows[index].slice(0, IMPORT_COLUMNS.length).map((cell) => (cell instanceof Date ? cell.toISOString() : cell));
    const linha = index + 1;
    const first = text(cells[0]).toLowerCase();
    if (index === 0 && first === "sku") continue;
    if (first.startsWith(TOTALS_MARKER)) break;
    if (cells.every((cell) => text(cell) === "")) continue;

    const mensagens: string[] = [];
    const sku = text(cells[0]);
    const name = text(cells[1]);
    const categoria = text(cells[2]).toUpperCase();
    if (!sku) mensagens.push("SKU vazio");
    if (!name) mensagens.push("Nome vazio");
    if (!CategoriaNomesEnum.options.includes(categoria as never)) {
      mensagens.push(categoria ? `Categoria "${categoria}" não existe` : "Categoria vazia");
    }

    const number = (column: number, label: string, required: boolean) => {
      const raw = text(cells[column]);
      if (raw === "" && typeof cells[column] !== "number") {
        if (required) mensagens.push(`${label} vazio`);
        return undefined;
      }
      const value = parseNumberCell(cells[column]);
      if (value === null) mensagens.push(`${label} não é um número ("${raw}")`);
      else if (value < 0) mensagens.push(`${label} não pode ser negativo`);
      return value ?? undefined;
    };
    const custo = number(3, "Valor de custo", true);
    const icms = number(4, "ICMS", false);
    const venda = number(5, "Valor de venda", false);
    const estoque = number(6, "Estoque", true);
    if (estoque !== undefined && !Number.isInteger(estoque)) mensagens.push("Estoque precisa ser um número inteiro");

    const repeatedFrom = sku ? firstLineBySku.get(sku) : undefined;
    if (repeatedFrom !== undefined) mensagens.push(`SKU ${sku} repetido (já está na linha ${repeatedFrom})`);
    else if (sku) firstLineBySku.set(sku, linha);

    if (mensagens.length > 0) {
      errors.push({ linha, mensagens });
      continue;
    }
    items.push({
      linha,
      sku,
      name,
      categoria: { nome: categoria },
      valor_de_custo: custo!,
      icms,
      valor_de_venda: venda,
      quantidade_em_estoque: estoque!,
    });
  }
  return { items, errors };
}

// header plus one example row, in the import's column order
export const importTemplateCsv = () =>
  toCsv([[...IMPORT_COLUMNS], ["SKU-0001", "Mouse sem fio", "INFORMATICA", "45,90", "18", "89,90", "25"]]);
