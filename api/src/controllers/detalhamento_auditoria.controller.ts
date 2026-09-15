import { Request, Response, NextFunction } from "express";
import IDetalhamentoAuditoria from "../interfaces/detalhamento_auditoria_interfaces/detalhamento_auditoria_service.interface";

class DetalhamentoAuditoriaController {
  constructor(private detalhamentoAuditoriaService: IDetalhamentoAuditoria) {}

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.detalhamentoAuditoriaService.createDetalhamentAuditoria(req.body);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.detalhamentoAuditoriaService.findDetalhamentoAuditoriaById(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.detalhamentoAuditoriaService.getDetalhamentosAuditoria(page, amount);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.detalhamentoAuditoriaService.updateDetalhamentoAuditoria(req.body);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send();
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.detalhamentoAuditoriaService.deleteDetalhamentoAuditoria(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send();
  };
}

export default DetalhamentoAuditoriaController;
