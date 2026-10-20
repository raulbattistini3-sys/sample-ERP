import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import IntegracaoService from "../services/integracao.service";
import MondayService from "../services/monday.service";
import IntegracaoEnviosRepository from "../repositories/integracao_envios.repository";
import IntegracaoEnvioWorker from "../queues/integracao_envios.worker";
import { ENVIO_QUEUES, MAX_ATTEMPTS } from "../queues/integracao_envios.jobs";
import { Provider } from "../configs/oauth.providers";
import { ValidationError } from "../errors/client_errors/four_xx.error";

const isProvider = (value: string): value is Provider => value in ENVIO_QUEUES;

class IntegracaoController extends BaseController {
  constructor(
    private integracaoService: IntegracaoService,
    private mondayService: MondayService,
    private envios: IntegracaoEnviosRepository,
    private envioWorker: IntegracaoEnvioWorker,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  list = async (req: Request, res: Response) => {
    return res.status(200).json({ data: await this.integracaoService.list() });
  };

  // JSON, not a redirect: the web app opens the URL itself (this request needs the Bearer token)
  authorize = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.integracaoService.authorizeUrl(req.params.provider as string, req.user!.id);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json(result.value);
  };

  // public: the provider redirects the browser here; we always send it on to the web app
  callback = async (req: Request, res: Response) => {
    return res.redirect(302, await this.integracaoService.handleCallback(req.params.provider as string, req.query));
  };

  disconnect = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.integracaoService.disconnect(req.params.provider as string);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(204).send();
  };

  // ---- Jira ----

  jiraProjects = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.integracaoService.listJiraProjects();
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  saveJiraConfig = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.integracaoService.saveJiraConfig(req.body);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  jiraTestIssue = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.integracaoService.createJiraTestIssue(req.user!.nome);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json(result.value);
  };

  // ---- monday.com ----

  // the boards to pick from, plus the auditoria fields that can be mapped to their columns
  mondayBoards = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.mondayService.listBoards();
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  saveMondayConfig = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.mondayService.saveConfig(req.body);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(200).json({ data: result.value });
  };

  mondayTestItem = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.mondayService.createTestItem(req.user!.nome);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json(result.value);
  };

  // ---- issues/items of new auditorias ----

  // an auditoria's issues/items in every integration (one per categoria): any signed-in usuario
  enviosForAuditoria = async (req: Request, res: Response) => {
    return res.status(200).json({ data: await this.envios.listForAuditoria(req.params.auditoriaId as string) });
  };

  queueSummary = async (req: Request, res: Response, next: NextFunction) => {
    const provider = req.params.provider as string;
    if (!isProvider(provider)) return this.fail(req, next, new ValidationError("404", "Integração não encontrada"));
    return res.status(200).json({ data: { ...(await this.envios.summary(provider, MAX_ATTEMPTS)), maxTentativas: MAX_ATTEMPTS } });
  };

  // the provider's rows that gave up start over with a new job (the ones still retrying keep their schedule)
  retryQueue = async (req: Request, res: Response, next: NextFunction) => {
    const provider = req.params.provider as string;
    if (!isProvider(provider)) return this.fail(req, next, new ValidationError("404", "Integração não encontrada"));
    const reenviadas = (await this.envios.resetExhausted(provider, MAX_ATTEMPTS)).length;
    await this.envioWorker.enqueueMissing();
    return res.status(202).json({ reenviadas });
  };
}

export default IntegracaoController;
