import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import ClienteController from "../controllers/cliente.controller";
import ClienteService from "../services/cliente.service";
import ClienteSenioridadeRepository from "../repositories/cliente_senioridade.repository";
import EmpresaController from "../controllers/empresa.controller";
import EmpresaService from "../services/empresa.service";
import EmpresaContatoErpRepository from "../repositories/empresa_contato_erp.repository";
import { authMiddleware } from "./auth_middleware.instance";
import { hubspotService } from "./integracao.routes";
import { grpcImportador } from "./product.routes";
import ClienteImportacaoController from "../controllers/cliente_importacao.controller";
import { uploadPlanilhaClientes } from "../middlewares/upload.middleware";
import AtividadeService from "../services/atividade.service";
import AtividadeController from "../controllers/atividade.controller";
import ResendMailer from "../utils/mailer/resend_mailer.util";

const db = Config.getInstance().getDb();
const logger = AppLogger.getInstance();
export const clienteService = new ClienteService(hubspotService, new ClienteSenioridadeRepository(db));
export const empresaContatoErpRepository = new EmpresaContatoErpRepository(db);
const empresaService = new EmpresaService(hubspotService, empresaContatoErpRepository, (empresa) => clienteService.lembrarEmpresa(empresa));
const clienteController = new ClienteController(clienteService, logger);
const empresaController = new EmpresaController(empresaService, logger);
const clienteImportacaoController = new ClienteImportacaoController("clientes", grpcImportador, () => clienteService.limparCaches(), logger);
const empresaImportacaoController = new ClienteImportacaoController("empresas", grpcImportador, () => clienteService.limparCaches(), logger);
// note / e-mail / meeting shortcuts and the Funil board
const atividadeController = new AtividadeController(
  new AtividadeService(hubspotService, new ResendMailer(process.env.RESEND_API_KEY, process.env.COBRANCAS_EMAIL_FROM || process.env.EMAIL_FROM || undefined)),
  logger,
);

// names, emails and phones: ADM and SU only
const clienteRoutes = Router();
clienteRoutes.use(authMiddleware.requireAdminRole);
clienteRoutes.get("/", clienteController.getAll);
clienteRoutes.post("/", clienteController.create);
clienteRoutes.post("/atividades", atividadeController.create);
clienteRoutes.get("/funil", atividadeController.funil);
// spreadsheets of up to 500,000 clients, done by the Go importer: 202, then poll /importacoes/:id and
// page its errors with /importacoes/:id/erros?depois=<last seq>
clienteRoutes.post("/importacoes", uploadPlanilhaClientes, clienteImportacaoController.start);
clienteRoutes.get("/importacoes/:id", clienteImportacaoController.getById);
clienteRoutes.get("/importacoes/:id/erros", clienteImportacaoController.getErros);
// companies: before /:id, so "empresas" is never read as a client id
clienteRoutes.get("/empresas", clienteController.getEmpresas);
clienteRoutes.get("/empresas/setores", empresaController.getSetores);
clienteRoutes.get("/empresas/responsaveis", atividadeController.responsaveis);
clienteRoutes.post("/empresas", empresaController.create);
// companies spreadsheets, the same way (its own template: Nome, Domínio, Setor, ..., E-mail SAC)
clienteRoutes.post("/empresas/importacoes", uploadPlanilhaClientes, empresaImportacaoController.start);
clienteRoutes.get("/empresas/importacoes/:id", empresaImportacaoController.getById);
clienteRoutes.get("/empresas/importacoes/:id/erros", empresaImportacaoController.getErros);
clienteRoutes.get("/empresas/:id", empresaController.getById);
clienteRoutes.put("/empresas/:id", empresaController.update);
clienteRoutes.put("/empresas/:id/estagio", atividadeController.mover);
clienteRoutes.get("/empresas/:id/clientes", clienteController.getDaEmpresa);
clienteRoutes.post("/empresas/:id/clientes", clienteController.vincularEmpresa);
clienteRoutes.get("/:id", clienteController.getById);
clienteRoutes.put("/:id", clienteController.update);

export { clienteRoutes };
