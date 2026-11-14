import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { ValidationError } from "../errors/client_errors/four_xx.error";

// Products: a 5000-row spreadsheet is a few hundred KB, so 15 MB leaves plenty of room.
const MAX_PLANILHA_MB = 15;
// Clientes: up to 500,000 rows go to the Go importer, which takes files up to its MAX_IMPORT_FILE_MB
// (128 by default). A 500,000-row .xlsx of contacts is around 30-40 MB; .csv a bit more.
const MAX_PLANILHA_CLIENTES_MB = Number(process.env.MAX_CLIENTES_IMPORT_FILE_MB) || 120;

// multipart/form-data with the spreadsheet in the "planilha" field, kept in memory as req.file;
// multer's errors become 400s with a message the page can show
const criarUpload = (maxMb: number) => {
   const single = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
   }).single("planilha");

   const mensagens: Partial<Record<multer.ErrorCode, string>> = {
      LIMIT_FILE_SIZE: `A planilha passa de ${maxMb} MB.`,
      LIMIT_FILE_COUNT: "Envie uma planilha por vez.",
      LIMIT_UNEXPECTED_FILE: 'Envie a planilha no campo "planilha".',
   };

   return (req: Request, res: Response, next: NextFunction) =>
      single(req, res, (error: unknown) => {
         if (!error) return next();
         if (error instanceof multer.MulterError) {
            return next(new ValidationError("400", mensagens[error.code] ?? "Não foi possível receber a planilha.", error));
         }
         return next(error);
      });
};

export const uploadPlanilha = criarUpload(MAX_PLANILHA_MB);
export const uploadPlanilhaClientes = criarUpload(MAX_PLANILHA_CLIENTES_MB);
