import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import UsuarioRepository from "../repositories/usuario.repository";
import AuthMiddleware from "../middlewares/auth.middleware";

// one instance shared by index.ts (every protected route) and usuario.routes.ts (admin-only routes)
export const authMiddleware = new AuthMiddleware(
  new UsuarioRepository(Config.getInstance().getDb()),
  AppLogger.getInstance(),
);
