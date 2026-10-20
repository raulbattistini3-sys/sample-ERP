import { readSheet } from "read-excel-file/browser";

export type SpreadsheetRow = unknown[];

export const SPREADSHEET_ACCEPT = ".csv,.xlsx";

// first sheet of a .xlsx, or a .csv, as rows of cells in column order
export async function readSpreadsheetRows(file: File): Promise<SpreadsheetRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    return (await readSheet(file)) as SpreadsheetRow[];
  }
  if (name.endsWith(".csv")) {
    return parseCsv(await file.text());
  }
  throw new Error("Formato não suportado. Envie um arquivo .csv ou .xlsx (o .xls antigo não é aceito).");
}

// the separator that appears most often outside quotes in the first line: ";" (Excel pt-BR), "," or tab
const detectSeparator = (firstLine: string) => {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char as keyof typeof counts]++;
  }
  const [best, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
  return count > 0 ? best : ";";
};

// RFC 4180: quoted fields may contain the separator, "" (a quote) and line breaks
export function parseCsv(text: string): SpreadsheetRow[] {
  const content = text.replace(/^\uFEFF/, "");
  const separator = detectSeparator(content.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
