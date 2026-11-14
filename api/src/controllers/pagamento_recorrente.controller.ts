import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import PagamentoRecorrenteService from "../services/pagamento_recorrente.service";

class PagamentoRecorrenteController extends BaseController {
  constructor(
    private readonly service: PagamentoRecorrenteService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  // ?clienteId=<HubSpot contact id> keeps one client's
  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const clienteId = typeof req.query.clienteId === "string" && req.query.clienteId ? req.query.clienteId : null;
    const result = await this.service.listar(clienteId);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.obter(String(req.params.id));
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    const { id, nome, email } = req.user!;
    const result = await this.service.criar(req.body, { id, nome, email });
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json({ data: result.value });
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.alterar(String(req.params.id), req.body);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  pausar = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.pausar(String(req.params.id));
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  retomar = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.retomar(String(req.params.id));
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  cancelar = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.cancelar(String(req.params.id));
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };
}

export default PagamentoRecorrenteController;
