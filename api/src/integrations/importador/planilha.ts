import { extname } from "node:path";
import { readSheet } from "read-excel-file/node";
import { ImportRowErrorDto, ImportRowPayload } from "../../dtos/product_dtos/import_products.dto";
import categoriasNomesEnum, { CategoriasNomesEnum } from "../../enums/categorias_nomes.enum";

// Reads an uploaded spreadsheet into import rows. The rules are the web's
// (web/src/features/produtos/utils/productsImport.ts, lib/spreadsheet.ts) and the Go importer's
// (importer/importacao/linha.go), so the same file gets the same outcome and messages on any path.

export const FORMATOS_PLANILHA = [".xlsx", ".csv"];
export const FORMATO_NAO_SUPORTADO = "Formato não suportado. Envie um arquivo .csv ou .xlsx (o .xls antigo não é aceito).";

type Celula = unknown;

// Columns are read by position, in this order; anything after Estoque is ignored
const NUM_COLUNAS = 7;
const [COL_SKU, COL_NOME, COL_CATEGORIA, COL_CUSTO, COL_ICMS, COL_VENDA, COL_ESTOQUE] = [0, 1, 2, 3, 4, 5, 6];

// where the export's totals section starts; reading stops there
const MARCADOR_TOTAIS = "total de venda por categoria";

// the separator that appears most often outside quotes in the first line: ";" (Excel pt-BR), "," or tab
const detectarSeparador = (primeiraLinha: string) => {
   const contagem = new Map([[";", 0], [",", 0], ["\t", 0]]);
   let entreAspas = false;
   for (const char of primeiraLinha) {
      if (char === '"') entreAspas = !entreAspas;
      else if (!entreAspas && contagem.has(char)) contagem.set(char, contagem.get(char)! + 1);
   }
   return [...contagem.entries()].reduce((melhor, atual) => (atual[1] > melhor[1] ? atual : melhor))[0];
};

// RFC 4180: quoted fields may contain the separator, "" (a quote) and line breaks
const lerCsv = (dados: Buffer): Celula[][] => {
   const conteudo = dados.toString("utf8").replace(/^﻿/, "");
   const separador = detectarSeparador(conteudo.split(/\r?\n/, 1)[0] ?? "");
   const linhas: string[][] = [];
   let linha: string[] = [];
   let campo = "";
   let entreAspas = false;

   for (let i = 0; i < conteudo.length; i++) {
      const char = conteudo[i];
      if (entreAspas) {
         if (char === '"' && conteudo[i + 1] === '"') {
            campo += '"';
            i++;
         } else if (char === '"') {
            entreAspas = false;
         } else {
            campo += char;
         }
      } else if (char === '"') {
         entreAspas = true;
      } else if (char === separador) {
         linha.push(campo);
         campo = "";
      } else if (char === "\n" || char === "\r") {
         if (char === "\r" && conteudo[i + 1] === "\n") i++;
         linha.push(campo);
         linhas.push(linha);
         linha = [];
         campo = "";
      } else {
         campo += char;
      }
   }
   if (campo !== "" || linha.length > 0) {
      linha.push(campo);
      linhas.push(linha);
   }
   return linhas;
};

// first sheet of a .xlsx, or a .csv, as rows of cells in column order. Blank rows are kept, so a row's
// index + 1 is the line Excel shows. Throws with a message for the user when the file can't be read.
export async function lerPlanilha(nomeArquivo: string, dados: Buffer): Promise<Celula[][]> {
   switch (extname(nomeArquivo).toLowerCase()) {
      case ".xlsx":
         try {
            return await readSheet(dados);
         } catch {
            throw new Error("Não foi possível ler o arquivo .xlsx.");
         }
      case ".csv":
         return lerCsv(dados);
      default:
         throw new Error(FORMATO_NAO_SUPORTADO);
   }
}

const texto = (valor: Celula) => (valor === null || valor === undefined ? "" : String(valor).trim());

// numbers as typed in a pt-BR or en spreadsheet: 4090 | 4090,5 | 4.090,50 | 4,090.50 | R$ 4.090,50 | 17,5%
const lerNumero = (valor: Celula): number | null => {
   if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
   let raw = texto(valor).replace(/R\$|%|\s/g, "");
   if (raw === "") return null;
   const ultimaVirgula = raw.lastIndexOf(",");
   const ultimoPonto = raw.lastIndexOf(".");
   if (ultimaVirgula > -1 && ultimoPonto > -1) {
      // the later separator is the decimal one
      raw = ultimaVirgula > ultimoPonto ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
   } else if (ultimaVirgula > -1) {
      raw = raw.replace(",", ".");
   } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
      raw = raw.replace(/\./g, ""); // 4.090 = four thousand and ninety
   }
   const numero = Number(raw);
   return Number.isFinite(numero) ? numero : null;
};

// the rows before the export's totals section, which ends the data
export const semTotais = (linhas: Celula[][]) => {
   const fim = linhas.findIndex((l) => texto(l[COL_SKU]).toLowerCase().startsWith(MARCADOR_TOTAIS));
   return fim === -1 ? linhas : linhas.slice(0, fim);
};

const eCabecalho = (celulas: Celula[], linha: number) => linha === 1 && texto(celulas[COL_SKU]).toLowerCase() === "sku";

// Rows -> products, without looking at other rows. deslocamento is how many rows of the sheet come
// before these, so a line number is still the one Excel shows. The first row of the sheet is skipped
// when it's the header (first cell "SKU"); blank rows are skipped.
export function linhasParaImportar(linhas: Celula[][], deslocamento = 0): { items: ImportRowPayload[]; errors: ImportRowErrorDto[] } {
   const items: ImportRowPayload[] = [];
   const errors: ImportRowErrorDto[] = [];

   for (let index = 0; index < linhas.length; index++) {
      const celulas = linhas[index].slice(0, NUM_COLUNAS).map((c) => (c instanceof Date ? c.toISOString() : c));
      const linha = deslocamento + index + 1;
      if (eCabecalho(celulas, linha)) continue;
      if (celulas.every((c) => texto(c) === "")) continue;

      const mensagens: string[] = [];
      const sku = texto(celulas[COL_SKU]);
      const name = texto(celulas[COL_NOME]);
      const categoria = texto(celulas[COL_CATEGORIA]).toUpperCase();
      if (!sku) mensagens.push("SKU vazio");
      if (!name) mensagens.push("Nome vazio");
      if (!categoriasNomesEnum.options.includes(categoria as CategoriasNomesEnum)) {
         mensagens.push(categoria ? `Categoria "${categoria}" não existe` : "Categoria vazia");
      }

      const numero = (coluna: number, rotulo: string, obrigatorio: boolean) => {
         const raw = texto(celulas[coluna]);
         if (raw === "") {
            if (obrigatorio) mensagens.push(`${rotulo} vazio`);
            return undefined;
         }
         const valor = lerNumero(celulas[coluna]);
         if (valor === null) mensagens.push(`${rotulo} não é um número ("${raw}")`);
         else if (valor < 0) mensagens.push(`${rotulo} não pode ser negativo`);
         return valor ?? undefined;
      };
      const custo = numero(COL_CUSTO, "Valor de custo", true);
      const icms = numero(COL_ICMS, "ICMS", false);
      const venda = numero(COL_VENDA, "Valor de venda", false);
      const estoque = numero(COL_ESTOQUE, "Estoque", true);
      if (estoque !== undefined && !Number.isInteger(estoque)) mensagens.push("Estoque precisa ser um número inteiro");

      if (mensagens.length > 0) {
         errors.push({ linha, mensagens });
         continue;
      }
      items.push({
         linha,
         sku,
         name,
         categoria: { nome: categoria },
         valor_de_custo: custo,
         icms,
         valor_de_venda: venda,
         quantidade_em_estoque: estoque,
      });
   }
   return { items, errors };
}

// The rows repeating an earlier row's SKU, as linha -> message. A row with other errors still claims its SKU.
export function skusRepetidos(linhas: Celula[][]): Map<number, string> {
   const repetidos = new Map<number, string>();
   const primeiraLinhaDoSku = new Map<string, number>();
   linhas.forEach((celulas, index) => {
      const linha = index + 1;
      const sku = texto(celulas[COL_SKU]);
      if (!sku || eCabecalho(celulas, linha)) return;
      const primeira = primeiraLinhaDoSku.get(sku);
      if (primeira !== undefined) repetidos.set(linha, `SKU ${sku} repetido (já está na linha ${primeira})`);
      else primeiraLinhaDoSku.set(sku, linha);
   });
   return repetidos;
}
