import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import CobrancaController from "../controllers/cobranca.controller";
import CobrancaService from "../services/cobranca.service";
import BillingClient from "../integrations/billing/billing.client";
import ResendMailer from "../utils/mailer/resend_mailer.util";
import { authMiddleware } from "./auth_middleware.instance";
import { hubspotService } from "./integracao.routes";
import Config from "../configs/app_config";
import PagamentoRecorrenteController from "../controllers/pagamento_recorrente.controller";
import PagamentoRecorrenteService from "../services/pagamento_recorrente.service";
import PagamentoRecorrenteRepository from "../repositories/pagamento_recorrente.repository";
import PagamentoRecorrenteWorker from "../queues/pagamento_recorrente.worker";
import AvisosDeCobrancaService from "../services/avisos_cobranca.service";
import EnviosExternosRepository from "../repositories/envios_externos.repository";
import WhatsappClient from "../integrations/whatsapp/whatsapp.client";
import { eventosDeCobranca } from "../sockets/cobrancas.sse";

const logger = AppLogger.getInstance();
const billing = new BillingClient();
// any valid sender: COBRANCAS_EMAIL_FROM, else the one the API already sends with (EMAIL_FROM / Resend's)
const mailer = new ResendMailer(process.env.RESEND_API_KEY, process.env.COBRANCAS_EMAIL_FROM || process.env.EMAIL_FROM || undefined);
// HubSpot timeline notes, "customer" on payment, WhatsApp (also used by billing.routes' webhook)
export const avisosDeCobranca = new AvisosDeCobrancaService(
  hubspotService, billing, new EnviosExternosRepository(Config.getInstance().getDb()), new WhatsappClient(), logger,
);
const controller = new CobrancaController(new CobrancaService(hubspotService, billing, mailer, logger, avisosDeCobranca), billing, logger);

// client names, e-mails and money: ADM and SU only
const stripeRoutes = Router();
stripeRoutes.use(authMiddleware.requireAdminRole);
stripeRoutes.get("/", controller.stripe);

const cobrancaRoutes = Router();
cobrancaRoutes.use(authMiddleware.requireAdminRole);
cobrancaRoutes.get("/", controller.recentes);
cobrancaRoutes.get("/pagas", controller.pagas);
// Server-Sent Events: each payment the billing webhook reports, as it arrives
cobrancaRoutes.get("/eventos", eventosDeCobranca);
cobrancaRoutes.post("/", controller.emitir);
// backfill: every invoice already issued gets its HubSpot timeline note (and the paid ones "customer")
cobrancaRoutes.get("/linha-do-tempo", (_req, res) => {
  res.status(200).json({ data: { ...avisosDeCobranca.sincronizacao(), whatsappConfigurado: avisosDeCobranca.whatsappConfigurado } });
});
cobrancaRoutes.post("/linha-do-tempo/sincronizar", (_req, res) => {
  res.status(202).json({ data: { ...avisosDeCobranca.sincronizar(), whatsappConfigurado: avisosDeCobranca.whatsappConfigurado } });
});

// Pagamento mensal: recurring charges per client, run by pagamentoRecorrenteWorker (started in index.ts)
const planos = new PagamentoRecorrenteRepository(Config.getInstance().getDb());
const recorrenteService = new PagamentoRecorrenteService(planos, hubspotService, billing, mailer, logger, avisosDeCobranca);
const recorrente = new PagamentoRecorrenteController(recorrenteService, logger);
export const pagamentoRecorrenteWorker = new PagamentoRecorrenteWorker(planos, recorrenteService, logger);

const pagamentoRecorrenteRoutes = Router();
pagamentoRecorrenteRoutes.use(authMiddleware.requireAdminRole);
pagamentoRecorrenteRoutes.get("/", recorrente.getAll);
pagamentoRecorrenteRoutes.post("/", recorrente.create);
pagamentoRecorrenteRoutes.get("/:id", recorrente.getById);
pagamentoRecorrenteRoutes.put("/:id", recorrente.update);
pagamentoRecorrenteRoutes.post("/:id/pausar", recorrente.pausar);
pagamentoRecorrenteRoutes.post("/:id/retomar", recorrente.retomar);
pagamentoRecorrenteRoutes.post("/:id/cancelar", recorrente.cancelar);

export { stripeRoutes, cobrancaRoutes, pagamentoRecorrenteRoutes };
