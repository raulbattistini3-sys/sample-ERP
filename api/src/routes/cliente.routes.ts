import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import ClienteController from "../controllers/cliente.controller";
import ClienteService from "../services/cliente.service";
import { authMiddleware } from "./auth_middleware.instance";
import { hubspotService } from "./integracao.routes";

const clienteController = new ClienteController(new ClienteService(hubspotService), AppLogger.getInstance());

// names, emails and phones: ADM and SU only
const clienteRoutes = Router();
clienteRoutes.use(authMiddleware.requireAdminRole);
clienteRoutes.get("/", clienteController.getAll);
clienteRoutes.get("/empresas", clienteController.getEmpresas);

export { clienteRoutes };
