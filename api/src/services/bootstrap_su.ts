import Config from "../configs/app_config";
import UsuarioRepository from "../repositories/usuario.repository";
import ErrorLevelsEnum from "../enums/errors_enums/errors_levels.enum";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import { hashPassword } from "../utils/helpers/password.util";

// A fresh database has no superuser, and the web app has no way to make one (POST /user/register only
// creates Estoque accounts). With BOOTSTRAP_SU_EMAIL and BOOTSTRAP_SU_PASSWORD set, startup creates an
// SU when there is no active one. Its senha is a known one, so it must change it at first sign-in
// (trocaSenhaObrigatoria). Set by docker-compose.yml and the native launcher; leave unset in production.
export async function ensureBootstrapSu(logger: LoggerInterface): Promise<void> {
   const email = process.env.BOOTSTRAP_SU_EMAIL?.trim();
   const senha = process.env.BOOTSTRAP_SU_PASSWORD;
   if (!email || !senha) {
      return;
   }
   const nome = process.env.BOOTSTRAP_SU_NAME?.trim() || "Administrador";
   const log = (level: keyof typeof ErrorLevelsEnum.Values, message: string, error?: unknown) =>
      logger.handle({ layer: "bootstrap", email, ...(error ? { error } : {}) }, ErrorLevelsEnum.Values[level], message);
   try {
      const repository = new UsuarioRepository(Config.getInstance().getDb());
      const all = await repository.getUsuarios();
      // getUsuarios answers an empty table with an error that has no cause: a fresh database
      if (all.isLeft() && all.value.cause) {
         throw all.value;
      }
      const existing = all.isRight() ? all.value : [];
      if (existing.some((u) => u.permissoes === "SU" && u.ativo)) {
         return;
      }
      if (existing.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
         log("WARN", "no active SU, but BOOTSTRAP_SU_EMAIL already belongs to an account; promote it instead");
         return;
      }
      const created = await repository.createUsuario({
         nome,
         email,
         senha: await hashPassword(senha),
         permissoes: "SU",
         ativo: true,
         trocaSenhaObrigatoria: true,
      });
      if (created.isLeft()) {
         throw created.value;
      }
      log("INFO", "created the bootstrap SU; it must change its password at first sign-in");
   } catch (error) {
      // the API still serves; an operator can create the SU by hand
      log("ERROR", "could not create the bootstrap SU", error);
   }
}
