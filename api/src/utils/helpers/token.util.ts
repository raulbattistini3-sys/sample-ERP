import jwt from "jsonwebtoken";
import { UsuarioEntity } from "../../entities/usuario.entity";

export const generateToken = (user: Pick<UsuarioEntity, "id" | "email">) =>
   jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: "1h" });
