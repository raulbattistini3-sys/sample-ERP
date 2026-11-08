import { Request, Response, NextFunction } from "express";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import { toUsuarioResponse } from "../mappers/usuario.mapper";
import { verifyToken } from "../utils/helpers/token.util";
import { isAdminRole } from "../utils/helpers/permissoes.util";
import { UsuarioResponseDto } from "../dtos/usuario_dtos/usuario_response.dto";
import { BaseAppError } from "../errors/global_error.error";

export type SessionResult =
   | { ok: true; usuario: UsuarioResponseDto; sessaoVersao: number }
   | { ok: false; message: string; error?: BaseAppError };

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
      const session = await this.resolveSession(token);
      if (!session.ok) {
         if (session.error) {
            return next(new ServerError("500", true, "internal server error", session.error));
         }
         return this.reject(req, next, "401", session.message);
      }
      req.user = session.usuario;
      req.sessaoVersao = session.sessaoVersao;
      return next();
   };

   // The checks behind authenticate, for any transport: the product socket (sockets/produtos.socket.ts)
   // runs them on every request too. `error` is set when the lookup itself failed (a 500); otherwise
   // `message` says why the token is refused (a 401).
   resolveSession = async (token: string): Promise<SessionResult> => {
      if (!token) {
         return { ok: false, message: "Token de autenticação ausente" };
      }
      const claims = verifyToken(token);
      if (!claims) {
         return { ok: false, message: "Token inválido ou expirado" };
      }

      const usuario = await this.userRepository.getUsuario(claims.usuarioId);
      if (usuario.isLeft()) {
         // a cause means the query itself failed; without one the usuario no longer exists
         if (usuario.value.cause) {
            return { ok: false, message: "internal server error", error: usuario.value };
         }
         return { ok: false, message: "Usuário não encontrado" };
      }
      if (!usuario.value.ativo) {
         return { ok: false, message: "Usuário inativo" };
      }
      // the senha changed after this token was issued (reset or an admin setting a new one)
      if (claims.sessaoVersao !== usuario.value.sessaoVersao) {
         return { ok: false, message: "Sessão encerrada porque a senha foi alterada. Entre novamente." };
      }
      return { ok: true, usuario: toUsuarioResponse(usuario.value), sessaoVersao: usuario.value.sessaoVersao };
   };

   // use after authenticate: a usuario created with a known senha (the BOOTSTRAP_SU_* superuser) gets
   // nothing but POST /user/change-password until it picks its own
   requirePasswordChanged = (req: Request, res: Response, next: NextFunction) => {
      if (!req.user?.trocaSenhaObrigatoria) {
         return next();
      }
      return this.reject(req, next, "403", "Troque sua senha antes de continuar.");
   };

   // ADM or SU; use after authenticate. Which accounts an ADM may touch is decided in UsuarioService
   requireAdminRole = (req: Request, res: Response, next: NextFunction) => {
      if (isAdminRole(req.user?.permissoes)) {
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
