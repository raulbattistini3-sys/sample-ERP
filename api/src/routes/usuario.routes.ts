import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import UsuarioController from "../controllers/usuario.controller";
import UsuarioService from "../services/usuario.service";
import UsuarioRepository from "../repositories/usuario.repository";
import UsuarioValidator from "../validators/usuario.validator";
import { authMiddleware } from "./auth_middleware.instance";

const config = Config.getInstance();
const logger = AppLogger.getInstance();
const  db = config.getDb();

const usuarioRepository = new UsuarioRepository(db);

const usuarioValidator = new UsuarioValidator();

const usuarioService = new UsuarioService(usuarioRepository, usuarioValidator);

const usuarioController = new UsuarioController(usuarioService, logger);

// the only routes reachable without a token (mounted before AuthMiddleware in routes/index.ts)
const publicUsuarioRoutes = Router();
publicUsuarioRoutes.post("/register", usuarioController.register);
publicUsuarioRoutes.post("/login", usuarioController.login);

// mounted after AuthMiddleware.authenticate, so req.user is set
const usuarioRoutes = Router();
// sliding session: the web calls this on user activity before the token expires
usuarioRoutes.post("/refresh-token", usuarioController.refreshToken);
// any signed-in usuario can read (the auditoria pages show auditor names); ADM/SU manage,
// and UsuarioService only lets an SU touch ADM/SU accounts
usuarioRoutes.get("/", usuarioController.getAll);
usuarioRoutes.get("/:id", usuarioController.getById);
usuarioRoutes.post("/", authMiddleware.requireAdminRole, usuarioController.create);
usuarioRoutes.put("/:id", authMiddleware.requireAdminRole, usuarioController.update);
usuarioRoutes.delete("/:id", authMiddleware.requireAdminRole, usuarioController.delete);
usuarioRoutes.patch("/:id/archive", authMiddleware.requireAdminRole, usuarioController.archive);

export { publicUsuarioRoutes, usuarioRoutes };
