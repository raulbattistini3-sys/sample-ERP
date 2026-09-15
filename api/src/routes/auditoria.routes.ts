import { Router } from "express";
import AuditoriaController from "../controllers/auditoria.controller";
import { AuditoriaService } from "../services/auditoria.service";
import AuditoriaRepository from "../repositories/auditoria.repository";
import AuditoriaValidator from "../validators/auditoria.validator";
import DetalhamentoAuditoriaRepository from "../repositories/detalhamento_auditoria.repository";
import DetalhamentoAuditoriaValidator from "../validators/detalhamento_auditoria.validator";
import postgresConnection from "../db/postgres_connection";

const detalhamentoAuditoriaRepository = new DetalhamentoAuditoriaRepository(postgresConnection);
const detalhamentoAuditoriaValidator = new DetalhamentoAuditoriaValidator();

const auditoriaRepository = new AuditoriaRepository(postgresConnection);
const auditoriaValidator = new AuditoriaValidator();

const auditoriaService = new AuditoriaService(
  detalhamentoAuditoriaRepository,
  auditoriaRepository,
  auditoriaValidator,
);

const auditoriaController = new AuditoriaController(auditoriaService);

const auditoriaRoutes = Router();

auditoriaRoutes.post("/", auditoriaController.create);
auditoriaRoutes.get("/", auditoriaController.getAll);
auditoriaRoutes.get("/:id", auditoriaController.getById);
auditoriaRoutes.put("/:id", auditoriaController.update);
auditoriaRoutes.delete("/:id", auditoriaController.delete);
auditoriaRoutes.patch("/:id/archive", auditoriaController.archive);

export { auditoriaRoutes };
