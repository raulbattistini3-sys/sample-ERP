import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import AuditoriaController from "../controllers/auditoria.controller";
import { AuditoriaService } from "../services/auditoria.service";
import AuditoriaRepository from "../repositories/auditoria.repository";
import AuditoriaValidator from "../validators/auditoria.validator";
import DetalhamentoAuditoriaRepository from "../repositories/detalhamento_auditoria.repository";
import AuditoriaConsolidacaoWorker from "../queues/auditoria_consolidacao.worker";
import { contarPendentes } from "../repositories/audit_trail.repository";
import { planilhaDeAuditorias } from "../services/auditoria_planilha";
import { parseListFilters } from "../utils/helpers/list_filters";
import { AUDITORIA_FILTERS } from "../utils/schemas/list_filters.schema";


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

// turns the queued product/categoria changes into automatic auditorias every few minutes (index.ts starts it)
export const auditoriaConsolidacaoWorker = new AuditoriaConsolidacaoWorker(db, logger);

const auditoriaRoutes = Router();

// changes waiting for the next sweep, and the sweep's schedule
auditoriaRoutes.get("/pendentes", async (_req, res, next) => {
  try {
    res.status(200).json({ data: { ...(await contarPendentes(db)), ...auditoriaConsolidacaoWorker.agenda() } });
  } catch (error) {
    next(error);
  }
});
// "Gerar agora": runs the sweep without waiting for the timer
auditoriaRoutes.post("/pendentes/consolidar", async (_req, res, next) => {
  try {
    res.status(200).json({ data: await auditoriaConsolidacaoWorker.consolidar() });
  } catch (error) {
    next(error);
  }
});

// "Baixar planilha": CSV of the auditorias matching the list's filters (?acao=&auditor=), or ?id= for one
auditoriaRoutes.get("/planilha", async (req, res, next) => {
  try {
    const filtros = parseListFilters(req.query, AUDITORIA_FILTERS);
    if (filtros.isLeft()) return next(filtros.value);
    const id = typeof req.query.id === "string" && /^[0-9a-f-]{36}$/i.test(req.query.id) ? req.query.id : undefined;
    const csv = await planilhaDeAuditorias(db, filtros.value, id);
    const nome = id ? `auditoria-${id.slice(0, 8)}.csv` : `auditorias-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
});

auditoriaRoutes.post("/", auditoriaController.create);
auditoriaRoutes.post("/manual", auditoriaController.createManual);
auditoriaRoutes.get("/", auditoriaController.getAll);
auditoriaRoutes.get("/:id", auditoriaController.getById);
auditoriaRoutes.put("/:id", auditoriaController.update);
auditoriaRoutes.delete("/:id", auditoriaController.delete);
auditoriaRoutes.patch("/:id/archive", auditoriaController.archive);

export { auditoriaRoutes };
