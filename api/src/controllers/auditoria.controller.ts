import { Request, Response, NextFunction } from "express";
import { IAuditoriaService } from "../interfaces/auditory_interfaces/auditoria_service.interface";

class UsuarioController {
  constructor(private auditoriaService: IAuditoriaService) {}

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.createAuditoria(req.body);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.findAuditoriasById(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.auditoriaService.getAuditorias(page, amount);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.updateAuditoria(req.body);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send();
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.deleteAuditoria(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send();
  };

  archive = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.archiveAuditoria(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

}

export default UsuarioController;
