import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import EmpresaService from "../services/empresa.service";

class EmpresaController extends BaseController {
  constructor(
    private readonly empresaService: EmpresaService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.empresaService.obter(String(req.params.id));
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  getSetores = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.empresaService.listarSetores();
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.empresaService.criar(req.body, req.user!.id);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json({ data: result.value.empresa, aviso: result.value.aviso });
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.empresaService.atualizar(String(req.params.id), req.body, req.user!.id);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value.empresa, aviso: result.value.aviso });
  };
}

export default EmpresaController;
