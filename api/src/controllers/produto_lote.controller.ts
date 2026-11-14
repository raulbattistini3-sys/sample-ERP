import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ProdutoLoteService from "../services/produto_lote.service";
import { isAdminRole } from "../utils/helpers/permissoes.util";

class ProdutoLoteController extends BaseController {
  constructor(
    private readonly service: ProdutoLoteService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  // POST /products/lote { acao, ids }
  executar = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.executar(req.body, req.user!.id, isAdminRole(req.user?.permissoes));
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  // GET /products/marcacoes: the user's favourites and "save for later", newest first
  getMarcacoes = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.listarMarcacoes(req.user!.id);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };
}

export default ProdutoLoteController;
