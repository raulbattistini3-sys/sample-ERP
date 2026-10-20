import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import IntegracaoService from "../services/integracao.service";
import JiraOutboxRepository from "../repositories/jira_outbox.repository";
import JiraIssueDispatcher, { MAX_ATTEMPTS } from "../services/jira_issue_dispatcher.service";

class IntegracaoController extends BaseController {
  constructor(
    private integracaoService: IntegracaoService,
    private jiraOutbox: JiraOutboxRepository,
    private jiraDispatcher: JiraIssueDispatcher,
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

  // the auditoria's Jira issues (one per categoria): any signed-in usuario, shown on the auditoria page
  jiraIssuesForAuditoria = async (req: Request, res: Response) => {
    return res.status(200).json({ data: await this.jiraOutbox.listForAuditoria(req.params.auditoriaId as string) });
  };

  jiraQueue = async (req: Request, res: Response) => {
    return res.status(200).json({ data: { ...(await this.jiraOutbox.summary(MAX_ATTEMPTS)), maxTentativas: MAX_ATTEMPTS } });
  };

  // failed issues are tried again now
  retryJiraQueue = async (req: Request, res: Response) => {
    const reenviadas = await this.jiraOutbox.retryFailed();
    void this.jiraDispatcher.runOnce();
    return res.status(202).json({ reenviadas });
  };

  jiraTestIssue = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.integracaoService.createJiraTestIssue(req.user!.nome);
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(201).json(result.value);
  };
}

export default IntegracaoController;
