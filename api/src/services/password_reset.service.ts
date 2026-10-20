import { createHash, randomBytes } from "crypto";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import IUsuarioRepository from "../interfaces/usuario_interfaces/usuario_repository.interface";
import IPasswordResetRepository from "../interfaces/password_reset_interfaces/password_reset_repository.interface";
import { IUsuarioValidator } from "../interfaces/usuario_interfaces/usuario_validator.interface";
import MailerInterface from "../interfaces/mailer_interfaces/mailer.interface";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import serializeError from "../utils/logger/serialize_error.util";
import { hashPassword } from "../utils/helpers/password.util";
import { passwordResetEmail } from "../utils/mailer/password_reset_email.util";

const TOKEN_TTL_MINUTES = 30;
// a second request within this window doesn't send another email
const REQUEST_COOLDOWN_SECONDS = 60;

// same answer whether or not the email has an account, so the endpoint can't be used to find users
export const FORGOT_PASSWORD_MESSAGE =
   "Se houver uma conta ativa com esse e-mail, enviaremos um link para redefinir a senha.";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

class PasswordResetService {
   constructor(
      private readonly userRepository: IUsuarioRepository,
      private readonly passwordResetRepository: IPasswordResetRepository,
      private readonly userValidator: IUsuarioValidator,
      private readonly mailer: MailerInterface,
      private readonly logger: LoggerInterface,
      // where the web app runs; the email links to <webUrl>/reset-password?token=...
      private readonly webUrl = (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, ""),
   ) {}

   async requestReset(payload: unknown): Promise<Either<BaseAppError, { message: string }>> {
      const validation = this.userValidator.validateForgotPasswordPayload(payload);
      if (validation.isLeft()) {
         return left(validation.value);
      }
      const { email } = payload as { email: string };
      const generic: Either<BaseAppError, { message: string }> = right({ message: FORGOT_PASSWORD_MESSAGE });

      const usuario = await this.userRepository.getUsuarioByEmail(email.trim());
      if (usuario.isLeft()) {
         // no cause: no such email, which the caller must not learn
         return usuario.value.cause
            ? left(new ServerError("500", true, undefined, usuario.value))
            : generic;
      }
      if (!usuario.value.ativo) {
         return generic;
      }

      const recent = await this.passwordResetRepository.hasRecentToken(usuario.value.id, REQUEST_COOLDOWN_SECONDS);
      if (recent.isLeft()) {
         return left(new ServerError("500", true, undefined, recent.value));
      }
      if (recent.value) {
         return generic;
      }

      // 256 random bits, sent only in the email; the database keeps its hash
      const token = randomBytes(32).toString("base64url");
      const stored = await this.passwordResetRepository.createToken(usuario.value.id, sha256(token), TOKEN_TTL_MINUTES);
      if (stored.isLeft()) {
         return left(new ServerError("500", true, undefined, stored.value));
      }

      const link = `${this.webUrl}/reset-password?token=${token}`;
      // not awaited: answering before the email goes out keeps the response time the same
      // for existing and unknown emails. Failures are logged (never the token or the link)
      void this.mailer
         .send(passwordResetEmail(usuario.value.email, usuario.value.nome, link, TOKEN_TTL_MINUTES))
         .then((sent) => {
            if (sent.isLeft()) {
               this.logger.handle(
                  {
                     layer: "service",
                     service: this.constructor.name,
                     usuarioId: usuario.value.id,
                     error: serializeError(sent.value),
                  },
                  ErrorLevelsEnum.Values.ERROR,
                  "password reset email not sent",
               );
            }
         });
      return generic;
   }

   async resetPassword(payload: unknown): Promise<Either<BaseAppError, null>> {
      const validation = this.userValidator.validateResetPasswordPayload(payload);
      if (validation.isLeft()) {
         return left(validation.value);
      }
      const { token, senha } = payload as { token: string; senha: string };
      return this.passwordResetRepository.consumeToken(sha256(token), await hashPassword(senha));
   }
}

export default PasswordResetService;
