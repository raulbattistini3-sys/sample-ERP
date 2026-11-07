import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import CobrancaController from "../controllers/cobranca.controller";
import CobrancaService from "../services/cobranca.service";
import BillingClient from "../integrations/billing/billing.client";
import ResendMailer from "../utils/mailer/resend_mailer.util";
import { authMiddleware } from "./auth_middleware.instance";
import { hubspotService } from "./integracao.routes";

const logger = AppLogger.getInstance();
const billing = new BillingClient();
// any valid sender: COBRANCAS_EMAIL_FROM, else the one the API already sends with (EMAIL_FROM / Resend's)
const mailer = new ResendMailer(process.env.RESEND_API_KEY, process.env.COBRANCAS_EMAIL_FROM || process.env.EMAIL_FROM || undefined);
const controller = new CobrancaController(new CobrancaService(hubspotService, billing, mailer, logger), billing, logger);

// client names, e-mails and money: ADM and SU only
const stripeRoutes = Router();
stripeRoutes.use(authMiddleware.requireAdminRole);
stripeRoutes.get("/", controller.stripe);

const cobrancaRoutes = Router();
cobrancaRoutes.use(authMiddleware.requireAdminRole);
cobrancaRoutes.get("/", controller.recentes);
cobrancaRoutes.post("/", controller.emitir);

export { stripeRoutes, cobrancaRoutes };
