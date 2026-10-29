import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import AuditoriaController from "../controllers/auditoria.controller";
import { AuditoriaService } from "../services/auditoria.service";
import AuditoriaRepository from "../repositories/auditoria.repository";
import AuditoriaValidator from "../validators/auditoria.validator";
import DetalhamentoAuditoriaRepository from "../repositories/detalhamento_auditoria.repository";


const config = Config.getInstance();
const logger = AppLogger.getInstance();
const  db = config.getDb();

const detalhamentoAuditoriaRepository = new DetalhamentoAuditoriaRepository(db);


const auditoriaRepository = new AuditoriaRepository(db);
const auditoriaValidator = new AuditoriaValidator();

const auditoriaService = new AuditoriaService(
  detalhamentoAuditoriaRepository,
  auditoriaRepository,
  auditoriaValidator,
);

const auditoriaController = new AuditoriaController(auditoriaService, logger);

const auditoriaRoutes = Router();

auditoriaRoutes.post("/", auditoriaController.create);
auditoriaRoutes.post("/manual", auditoriaController.createManual);
auditoriaRoutes.get("/", auditoriaController.getAll);
auditoriaRoutes.get("/:id", auditoriaController.getById);
auditoriaRoutes.put("/:id", auditoriaController.update);
auditoriaRoutes.delete("/:id", auditoriaController.delete);
auditoriaRoutes.patch("/:id/archive", auditoriaController.archive);

export { auditoriaRoutes };
