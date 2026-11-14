import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import AtividadeService from "../services/atividade.service";
import { estagioDe, ESTAGIOS } from "../services/hubspot.service";

// Note / e-mail / meeting shortcuts, the Funil board and the HubSpot users a company can be assigned to
class AtividadeController extends BaseController {
  constructor(
    private readonly service: AtividadeService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  create = async (req: Request, res: Response, next: NextFunction) => {
    const { nome, email } = req.user!;
    const result = await this.service.registrar(req.body, { nome, email });
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json({ data: result.value });
  };

  responsaveis = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.responsaveis();
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  // GET /clientes/funil?estagio=lead&after=…&busca=…&limite=10 — one column, limite (1-100, default 25) per page
  funil = async (req: Request, res: Response, next: NextFunction) => {
    const estagio = typeof req.query.estagio === "string" ? req.query.estagio : "";
    const after = typeof req.query.after === "string" && req.query.after ? req.query.after : null;
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().slice(0, 100) : "";
    const limite = Number(req.query.limite) || 25;
    const result = await this.service.funil(estagio, after, busca, limite);
    if (result.isLeft()) return this.fail(req, next, result.value);
    const { results = [], total = 0, paging } = result.value;
    return res.status(200).json({
      data: results.map(({ id, properties: p }) => ({
        id,
        nome: p.name || p.domain || `Empresa ${id}`,
        dominio: p.domain || null,
        cidade: p.city || null,
        estado: p.state || null,
        setor: p.industry || null,
        responsavelId: p.hubspot_owner_id || null,
        estagio: estagioDe(p.lifecyclestage),
      })),
      total,
      proxima: paging?.next?.after ?? null,
      estagios: ESTAGIOS,
    });
  };

  mover = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.service.moverEmpresa(String(req.params.id), req.body);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(204).end();
  };
}

export default AtividadeController;
