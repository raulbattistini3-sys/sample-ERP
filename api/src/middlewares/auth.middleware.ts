import { Request, Response, NextFunction } from "express";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import permissoesUsuarioEnum from "../enums/usuarios_permissoes.enum";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import { toUsuarioResponse } from "../mappers/usuario.mapper";
import { verifyToken } from "../utils/helpers/token.util";

class AuthMiddleware {
   constructor(
      private readonly userRepository: IUsuarioRepository,
      private readonly logger: LoggerInterface,
   ) {}

   // requires "Authorization: Bearer <token>" from POST /user/login. The usuario is loaded on every
   // request, so deactivating someone or changing their permissoes applies right away, not when the token expires
   authenticate = async (req: Request, res: Response, next: NextFunction) => {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (!token) {
         return this.reject(req, next, "401", "Token de autenticação ausente");
      }
      const usuarioId = verifyToken(token);
      if (!usuarioId) {
         return this.reject(req, next, "401", "Token inválido ou expirado");
      }

      const usuario = await this.userRepository.getUsuario(usuarioId);
      if (usuario.isLeft()) {
         // a cause means the query itself failed; without one the usuario no longer exists
         if (usuario.value.cause) {
            return next(new ServerError("500", true, "internal server error", usuario.value));
         }
         return this.reject(req, next, "401", "Usuário não encontrado");
      }
      if (!usuario.value.ativo) {
         return this.reject(req, next, "401", "Usuário inativo");
      }

      req.user = toUsuarioResponse(usuario.value);
      return next();
   };

   // use after authenticate
   requireAdm = (req: Request, res: Response, next: NextFunction) => {
      if (req.user?.permissoes === permissoesUsuarioEnum.Values.ADM) {
         return next();
      }
      return this.reject(req, next, "403", "Apenas administradores podem realizar esta ação");
   };

   // the token itself is never logged
   private reject(req: Request, next: NextFunction, statusCode: "401" | "403", message: string) {
      this.logger.handle(
         {
            layer: "middleware",
            middleware: this.constructor.name,
            method: req.method,
            url: req.originalUrl,
            usuarioId: req.user?.id,
            statusCode: Number(statusCode),
         },
         ErrorLevelsEnum.Values.WARN,
         message,
      );
      return next(new ValidationError(statusCode, message));
   }
}

export default AuthMiddleware;
