import { availableParallelism } from "node:os";
import { extname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { ImportRowErrorDto, ValidatedImportRow } from "../../dtos/product_dtos/import_products.dto";

// below this a batch costs more to hand over than it saves
const LINHAS_MINIMAS_POR_LOTE = 1000;

// ts-node runs the sources in development, node runs dist/ in production
const extensao = extname(__filename);
const execArgv = extensao === ".ts" ? ["-r", "ts-node/register/transpile-only"] : undefined;

type Lote = { validos: ValidatedImportRow[]; erros: ImportRowErrorDto[] };

const validarLote = (linhas: unknown[][], deslocamento: number) =>
   new Promise<Lote>((resolve, reject) => {
      const worker = new Worker(join(__dirname, `planilha.worker${extensao}`), {
         workerData: { linhas, deslocamento },
         execArgv,
      });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`planilha worker exited with code ${code}`)));
   });

// Divides the rows equally among one worker thread per CPU and merges what they found. Repeated SKUs
// can span batches, so they are checked afterwards, by the caller.
export async function validarEmThreads(linhas: unknown[][]): Promise<Lote> {
   const threads = Math.max(1, Math.min(availableParallelism(), Math.ceil(linhas.length / LINHAS_MINIMAS_POR_LOTE)));
   const tamanho = Math.ceil(linhas.length / threads);
   const lotes = await Promise.all(
      Array.from({ length: threads }, (_, i) => validarLote(linhas.slice(i * tamanho, (i + 1) * tamanho), i * tamanho)),
   );
   return { validos: lotes.flatMap((l) => l.validos), erros: lotes.flatMap((l) => l.erros) };
}
