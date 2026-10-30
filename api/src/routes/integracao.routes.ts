import "dotenv/config";
import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import { providers } from "../configs/oauth.providers";
import IntegracaoRepository from "../repositories/integracao.repository";
import IntegracaoService from "../services/integracao.service";
import HubspotService from "../services/hubspot.service";
import IntegracaoController from "../controllers/integracao.controller";
import { authMiddleware } from "./auth_middleware.instance";
import IntegracaoEnviosRepository from "../repositories/integracao_envios.repository";
import IntegracaoEnvioWorker from "../queues/integracao_envios.worker";
import { queueClient } from "../queues/queue.client";
import { buildAuditoriaIssue } from "../services/auditoria_issue_content";

const logger = AppLogger.getInstance();
const db = Config.getInstance().getDb();
const integracaoRepository = new IntegracaoRepository(db);
const integracaoService = new IntegracaoService(integracaoRepository, providers, logger, {
  webUrl: (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, ""),
  // this API as the provider's servers/browser reach it; must match the callback URL registered in each
  // provider's developer console: <API_PUBLIC_URL>/integracoes/<jira|hubspot>/callback
  callbackBaseUrl: (process.env.API_PUBLIC_URL || `http://localhost:${Config.getInstance().getApiConfig().port}`).replace(/\/$/, ""),
  atlassianApiUrl: "https://api.atlassian.com",
  fetch: globalThis.fetch,
  hubspotServiceKey: process.env.HUBSPOT_SERVICE_KEY || undefined,
});
export const hubspotService = new HubspotService(integracaoRepository, integracaoService, {
  apiUrl: "https://api.hubapi.com",
  serviceKey: process.env.HUBSPOT_SERVICE_KEY || undefined,
});
const envios = new IntegracaoEnviosRepository(db);
// runs the pg-boss jobs that create the Jira issues / HubSpot tickets of new auditorias; started and
// stopped by index.ts
export const integracaoEnvioWorker = new IntegracaoEnvioWorker(
  queueClient,
  envios,
  {
    jira: (envio) => integracaoService.createJiraIssue(buildAuditoriaIssue(envio)),
    hubspot: (envio) => hubspotService.createAuditoriaTicket(envio),
  },
  logger,
);
const integracaoController = new IntegracaoController(integracaoService, hubspotService, envios, integracaoEnvioWorker, logger);

// mounted before AuthMiddleware: the provider redirects the browser here without our token;
// the single-use OAuth state identifies who started the connection
const publicIntegracaoRoutes = Router();
publicIntegracaoRoutes.get("/:provider/callback", integracaoController.callback);

// mounted after AuthMiddleware.authenticate; connecting tools is admin territory (ADM/SU)
const integracaoRoutes = Router();
// any signed-in usuario: the auditoria page lists its issues/tickets
integracaoRoutes.get("/auditorias/:auditoriaId", integracaoController.enviosForAuditoria);
integracaoRoutes.use(authMiddleware.requireAdminRole);
integracaoRoutes.get("/", integracaoController.list);
integracaoRoutes.get("/jira/projetos", integracaoController.jiraProjects);
integracaoRoutes.put("/jira/config", integracaoController.saveJiraConfig);
integracaoRoutes.post("/jira/teste", integracaoController.jiraTestIssue);
integracaoRoutes.get("/hubspot/pipelines", integracaoController.hubspotPipelines);
integracaoRoutes.put("/hubspot/config", integracaoController.saveHubspotConfig);
integracaoRoutes.post("/hubspot/teste", integracaoController.hubspotTestTicket);
integracaoRoutes.get("/:provider/fila", integracaoController.queueSummary);
integracaoRoutes.post("/:provider/fila/reenviar", integracaoController.retryQueue);
integracaoRoutes.get("/:provider/authorize", integracaoController.authorize);
integracaoRoutes.delete("/:provider", integracaoController.disconnect);

export { publicIntegracaoRoutes, integracaoRoutes };
