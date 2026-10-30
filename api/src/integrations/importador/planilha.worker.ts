import { parentPort, workerData } from "node:worker_threads";
import { ImportRowErrorDto } from "../../dtos/product_dtos/import_products.dto";
import { CreateProductDto } from "../../dtos/product_dtos/create_product.dto";
import ProdutoValidator from "../../validators/produto.validator";
import { linhasParaImportar } from "./planilha";

// One batch of a spreadsheet's rows (planilha_threads.ts): turns its cells into products and validates them.
const { linhas, deslocamento } = workerData as { linhas: unknown[][]; deslocamento: number };

const validator = new ProdutoValidator();
const { items, errors } = linhasParaImportar(linhas, deslocamento);

const validos: { linha: number; dto: CreateProductDto }[] = [];
const erros: ImportRowErrorDto[] = [...errors];
for (const item of items) {
   const result = validator.parseImportRow(item);
   if (result.isLeft()) erros.push({ linha: item.linha, mensagens: result.value });
   else validos.push({ linha: item.linha, dto: result.value });
}

parentPort!.postMessage({ validos, erros });
