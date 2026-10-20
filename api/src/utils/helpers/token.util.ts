import jwt from "jsonwebtoken";
import { UsuarioEntity } from "../../entities/usuario.entity";

export const generateToken = (user: Pick<UsuarioEntity, "id" | "email">) =>
   jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: "1h" });

// the usuario id (sub) of a valid, unexpired token signed with JWT_SECRET; null otherwise
export const verifyToken = (token: string): string | null => {
   try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!);
      return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
   } catch {
      return null;
   }
};
