import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import ClienteController from "../controllers/cliente.controller";
import ClienteRepository from "../repositories/cliente.repository";
import ClienteService from "../services/cliente.service";
import { authMiddleware } from "./auth_middleware.instance";
import { hubspotService } from "./integracao.routes";

const clienteRepository = new ClienteRepository(Config.getInstance().getDb());
const clienteController = new ClienteController(new ClienteService(clienteRepository, hubspotService), AppLogger.getInstance());

// names, emails and phones: ADM and SU only
const clienteRoutes = Router();
clienteRoutes.use(authMiddleware.requireAdminRole);
clienteRoutes.get("/", clienteController.getAll);
clienteRoutes.post("/sincronizar", clienteController.sincronizar);

export { clienteRoutes };
