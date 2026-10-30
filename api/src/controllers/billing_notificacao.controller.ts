import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import BillingNotificacaoService from "../services/billing_notificacao.service";

class BillingNotificacaoController extends BaseController {
  constructor(
    private readonly billingNotificacaoService: BillingNotificacaoService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  receber = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.billingNotificacaoService.receber(req.body);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(204).send();
  };
}

export default BillingNotificacaoController;
