import jwt from "jsonwebtoken";
import { UsuarioEntity } from "../../entities/usuario.entity";

export const generateToken = (user: Pick<UsuarioEntity, "id" | "email" | "sessaoVersao">) =>
   jwt.sign({ sub: user.id, email: user.email, ver: user.sessaoVersao }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
   });

export type TokenClaims = { usuarioId: string; sessaoVersao: number };

// claims of a valid, unexpired token signed with JWT_SECRET; null otherwise. Tokens issued before
// sessao_versao existed have no "ver" and count as version 0
export const verifyToken = (token: string): TokenClaims | null => {
   try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!);
      if (typeof payload !== "object" || typeof payload.sub !== "string") return null;
      return { usuarioId: payload.sub, sessaoVersao: typeof payload.ver === "number" ? payload.ver : 0 };
   } catch {
      return null;
   }
};
