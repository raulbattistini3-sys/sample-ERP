import { NextFunction, Request, Response } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import CobrancaService from "../services/cobranca.service";
import BillingClient from "../integrations/billing/billing.client";

const KEY = /^[A-Za-z0-9_.:-]{8,200}$/;

class CobrancaController extends BaseController {
  constructor(
    private readonly service: CobrancaService,
    private readonly billing: BillingClient,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  // GET /integracoes/stripe: is Stripe connected, and its latest events. Never an error status: the page
  // shows whatever is wrong (billing not configured, not running, key refused) as the card's state.
  stripe = async (req: Request, res: Response) => {
    if (!this.billing.configurado) {
      return res.status(200).json({ configurado: false, alcancavel: false, status: null, eventos: [], erro: null });
    }
    const limite = Math.min(Math.max(Number(req.query.limite) || 20, 1), 50);
    const [status, eventos] = await Promise.all([this.billing.status(), this.billing.eventos(limite)]);
    if (status.isLeft()) {
      return res.status(200).json({ configurado: true, alcancavel: false, status: null, eventos: [], erro: status.value.message });
    }
    return res.status(200).json({
      configurado: true,
      alcancavel: true,
      status: status.value,
      eventos: eventos.isRight() ? eventos.value : [],
      erro: eventos.isLeft() ? eventos.value.message : null,
    });
  };

  // POST /cobrancas: the Idempotency-Key (the gateway requires one) makes a retry bill nobody twice
  emitir = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("idempotency-key");
    const chave = header && KEY.test(header) ? header : undefined;
    const result = await this.service.emitir(req.body, { nome: req.user!.nome, email: req.user!.email }, chave);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json({ data: result.value });
  };

  recentes = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.recentes();
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };
}

export default CobrancaController;
