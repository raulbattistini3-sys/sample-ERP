import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import { IAuditoriaService } from "../interfaces/auditory_interfaces/auditoria_service.interface";
import { isAdminRole } from "../utils/helpers/permissoes.util";

class AuditoriaController extends BaseController {
  constructor(
    private auditoriaService: IAuditoriaService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  create = async (req: Request, res: Response, next: NextFunction) => {
    // the auditor is whoever is signed in, not whatever id the body carries
    const result = await this.auditoriaService.createAuditoria({ ...req.body, usuario_id: req.user?.id });
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(201).json(result.value);
  };

  // a manual auditoria applies its changes to the product/categoria it audits
  createManual = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.createAuditoriaManual(
      { ...req.body, usuario_id: req.user?.id },
      isAdminRole(req.user?.permissoes),
    );
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.findAuditoriasById(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.auditoriaService.getAuditorias(this.session(req), page, amount);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    // the URL decides which auditoria is updated; usuario_id only satisfies the shared schema
    const result = await this.auditoriaService.updateAuditoria({
      ...req.body,
      id: req.params.id,
      usuario_id: req.user?.id,
    });
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.deleteAuditoria(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  archive = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.auditoriaService.archiveAuditoria(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

}

export default AuditoriaController;
