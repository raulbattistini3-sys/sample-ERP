import "dotenv/config";
import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import { providers } from "../configs/oauth.providers";
import IntegracaoRepository from "../repositories/integracao.repository";
import IntegracaoService from "../services/integracao.service";
import IntegracaoController from "../controllers/integracao.controller";
import { authMiddleware } from "./auth_middleware.instance";

const logger = AppLogger.getInstance();
const integracaoService = new IntegracaoService(new IntegracaoRepository(Config.getInstance().getDb()), providers, logger, {
  webUrl: (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, ""),
  // this API as the provider's servers/browser reach it; must match the callback URL registered in the
  // provider's developer console (Atlassian: http://localhost:<APP_PORT>/integracoes/jira/callback)
  callbackBaseUrl: (process.env.API_PUBLIC_URL || `http://localhost:${process.env.APP_PORT || 3333}`).replace(/\/$/, ""),
  atlassianApiUrl: "https://api.atlassian.com",
  fetch: globalThis.fetch,
});
const integracaoController = new IntegracaoController(integracaoService, logger);

// mounted before AuthMiddleware: the provider redirects the browser here without our token;
// the single-use OAuth state identifies who started the connection
const publicIntegracaoRoutes = Router();
publicIntegracaoRoutes.get("/:provider/callback", integracaoController.callback);

// mounted after AuthMiddleware.authenticate; connecting tools is admin territory (ADM/SU)
const integracaoRoutes = Router();
integracaoRoutes.use(authMiddleware.requireAdminRole);
integracaoRoutes.get("/", integracaoController.list);
integracaoRoutes.get("/jira/projetos", integracaoController.jiraProjects);
integracaoRoutes.put("/jira/config", integracaoController.saveJiraConfig);
integracaoRoutes.post("/jira/teste", integracaoController.jiraTestIssue);
integracaoRoutes.get("/:provider/authorize", integracaoController.authorize);
integracaoRoutes.delete("/:provider", integracaoController.disconnect);

export { publicIntegracaoRoutes, integracaoRoutes };
