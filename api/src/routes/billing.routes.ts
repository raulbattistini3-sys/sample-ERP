import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import ResendMailer from "../utils/mailer/resend_mailer.util";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import BillingNotificacaoController from "../controllers/billing_notificacao.controller";
import BillingNotificacaoService, { AoPagar, SacDoCliente } from "../services/billing_notificacao.service";
import { requireClientCert } from "../middlewares/internal_token.middleware";
import { hubspotService } from "./integracao.routes";
import { empresaContatoErpRepository } from "./cliente.routes";
import { avisosDeCobranca } from "./cobranca.routes";
import { faturasPagas } from "../utils/cache/faturas_pagas";

// only billing reaches these: mutual TLS, its certificate must say CN=billing (no shared token any more)
export const createBillingRoutes = (mailer: MailerInterface, sacDoCliente?: SacDoCliente, aoPagar?: AoPagar) => {
  const controller = new BillingNotificacaoController(new BillingNotificacaoService(mailer, sacDoCliente, aoPagar ?? null), AppLogger.getInstance());
  const routes = Router();
  routes.use(requireClientCert("billing"));
  routes.post("/events", controller.receber);
  return routes;
};

// client e-mail → its HubSpot contact → the contact's company → that company's SAC e-mail
const sacDoCliente: SacDoCliente = async (email) => {
  const contatos = await hubspotService.readContactsByEmail([email]);
  if (contatos.isLeft()) return null;
  const empresaId = contatos.value[0]?.properties.associatedcompanyid;
  if (!empresaId) return null;
  return (await empresaContatoErpRepository.sacPorEmpresas([empresaId])).get(empresaId) ?? null;
};

// called by the billing service, not by the web app: mounted before AuthMiddleware in routes/index.ts
// invoice.paid → first the open Cobranças pages flip the invoice to "Paga" (and the lists stop showing it
// "Em aberto" while Stripe's search index catches up), then the HubSpot timeline note + "customer" in the Funil
export const billingRoutes = createBillingRoutes(new ResendMailer(), sacDoCliente, (fatura) => {
  faturasPagas.registrar({ ...fatura, pagaEm: new Date().toISOString() });
  return avisosDeCobranca.paga(fatura);
});
