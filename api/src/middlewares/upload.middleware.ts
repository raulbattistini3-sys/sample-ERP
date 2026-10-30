import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { ValidationError } from "../errors/client_errors/four_xx.error";

// A 5000-row spreadsheet is a few hundred KB; 3 MB leaves room and stays under the 4 MB a gRPC message
// may carry to the importer.
const MAX_PLANILHA_BYTES = 3 * 1024 * 1024;

const single = multer({
   storage: multer.memoryStorage(),
   limits: { fileSize: MAX_PLANILHA_BYTES, files: 1 },
}).single("planilha");

const mensagens: Partial<Record<multer.ErrorCode, string>> = {
   LIMIT_FILE_SIZE: "A planilha passa de 3 MB.",
   LIMIT_FILE_COUNT: "Envie uma planilha por vez.",
   LIMIT_UNEXPECTED_FILE: 'Envie a planilha no campo "planilha".',
};

// multipart/form-data with the spreadsheet in the "planilha" field, kept in memory as req.file;
// multer's errors become 400s with a message the page can show
export const uploadPlanilha = (req: Request, res: Response, next: NextFunction) =>
   single(req, res, (error: unknown) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
         return next(new ValidationError("400", mensagens[error.code] ?? "Não foi possível receber a planilha.", error));
      }
      return next(error);
   });
