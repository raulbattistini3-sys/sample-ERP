import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import ResendMailer from "../utils/mailer/resend_mailer.util";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import BillingNotificacaoController from "../controllers/billing_notificacao.controller";
import BillingNotificacaoService from "../services/billing_notificacao.service";
import { requireInternalToken } from "../middlewares/internal_token.middleware";

export const createBillingRoutes = (mailer: MailerInterface, token = process.env.BILLING_INTERNAL_TOKEN) => {
  const controller = new BillingNotificacaoController(new BillingNotificacaoService(mailer), AppLogger.getInstance());
  const routes = Router();
  routes.use(requireInternalToken(token));
  routes.post("/events", controller.receber);
  return routes;
};

// called by the billing service, not by the web app: mounted before AuthMiddleware in routes/index.ts
export const billingRoutes = createBillingRoutes(new ResendMailer());
