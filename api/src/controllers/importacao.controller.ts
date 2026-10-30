import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import IImportacaoService from "../interfaces/importacao_interfaces/importacao_service.interface";

class ImportacaoController extends BaseController {
   constructor(
      private readonly importacaoService: IImportacaoService,
      logger: LoggerInterface,
   ) {
      super(logger);
   }

   // 202: queued, not done; poll the Location until the status is concluida, rejeitada or falhou
   start = async (req: Request, res: Response, next: NextFunction) => {
      const result = await this.importacaoService.iniciar(req.file, req.user!.id);
      if (result.isLeft()) {
         return this.fail(req, next, result.value);
      }
      return res
         .status(202)
         .location(`${req.baseUrl}/imports/${result.value.id}`)
         .json({ data: result.value });
   };

   getById = async (req: Request, res: Response, next: NextFunction) => {
      const result = await this.importacaoService.obter(req.params.id as string);
      if (result.isLeft()) {
         return this.fail(req, next, result.value);
      }
      return res.status(200).json({ data: result.value });
   };
}

export default ImportacaoController;
