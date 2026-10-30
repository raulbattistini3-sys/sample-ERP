import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ClienteService from "../services/cliente.service";

const MAX_AMOUNT = 100;

const positive = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : fallback;
};

class ClienteController extends BaseController {
  constructor(
    private readonly clienteService: ClienteService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = positive(req.query.page, 1);
    const amount = Math.min(positive(req.query.amount, 20), MAX_AMOUNT);
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim() : "";
    const result = await this.clienteService.listar(this.session(req), page, amount, busca);
    if (result.isLeft()) return this.fail(req, next, result.value);
    const { data, totalItems } = result.value;
    return res.status(200).json({ data, pageNumber: page, pageSize: amount, totalItems });
  };

  // companies with their contacts ranked; ?decisores=true keeps only the ones with a decision maker
  getEmpresas = async (req: Request, res: Response, next: NextFunction) => {
    const page = positive(req.query.page, 1);
    const amount = Math.min(positive(req.query.amount, 20), MAX_AMOUNT);
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim() : "";
    const result = await this.clienteService.listarEmpresas(this.session(req), page, amount, busca, req.query.decisores === "true");
    if (result.isLeft()) return this.fail(req, next, result.value);
    const { data, totalItems, semEmpresa } = result.value;
    return res.status(200).json({ data, pageNumber: page, pageSize: amount, totalItems, sem_empresa: semEmpresa });
  };
}

export default ClienteController;
