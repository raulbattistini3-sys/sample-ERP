import { Router } from "express";
import DetalhamentoAuditoriaController from "../controllers/detalhamento_auditoria.controller";
import DetalhamentoAuditoriaService from "../services/detalhamento_auditoria.service";
import DetalhamentoAuditoriaRepository from "../repositories/detalhamento_auditoria.repository";
import DetalhamentoAuditoriaValidator from "../validators/detalhamento_auditoria.validator";
import postgresConnection from "../db/postgres_connection";

const detalhamentoAuditoriaRepository = new DetalhamentoAuditoriaRepository(postgresConnection);
const detalhamentoAuditoriaValidator = new DetalhamentoAuditoriaValidator();

const detalhamentoAuditoriaService = new DetalhamentoAuditoriaService(
  detalhamentoAuditoriaRepository,
  detalhamentoAuditoriaValidator
);

const detalhamentoController = new DetalhamentoAuditoriaController(detalhamentoAuditoriaService);

const detalhamentoAuditoriaRoutes = Router();


detalhamentoAuditoriaRoutes.post("/", detalhamentoController.create);
detalhamentoAuditoriaRoutes.get("/", detalhamentoController.getAll);
detalhamentoAuditoriaRoutes.get("/:id", detalhamentoController.getById);
detalhamentoAuditoriaRoutes.put("/:id", detalhamentoController.update);
detalhamentoAuditoriaRoutes.delete("/:id", detalhamentoController.delete);

export { detalhamentoAuditoriaRoutes };
