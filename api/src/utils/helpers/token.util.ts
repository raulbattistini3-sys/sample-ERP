import { jwtVerify, SignJWT } from "jose";
import { UsuarioEntity } from "../../entities/usuario.entity";

// HS256 with JWT_SECRET (secrets/generate.ts makes one with jose's generateSecret("HS256")). The key is the
// UTF-8 bytes of the string, so any long random value in a .env works too. Only HS256 is accepted on the
// way back, and only tokens this API issued for the web app (iss/aud), so a token minted for another
// service with the same secret is refused.
const ALG = "HS256";
const ISSUER = "sample-erp-api";
const AUDIENCE = "sample-erp-web";
const EXPIRES_IN = "1h";

const chave = () => new TextEncoder().encode(process.env.JWT_SECRET!);

export const generateToken = (user: Pick<UsuarioEntity, "id" | "email" | "sessaoVersao">): Promise<string> =>
   new SignJWT({ email: user.email, ver: user.sessaoVersao })
      .setProtectedHeader({ alg: ALG, typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(EXPIRES_IN)
      .sign(chave());

export type TokenClaims = { usuarioId: string; sessaoVersao: number };

// claims of a valid, unexpired token signed with JWT_SECRET; null otherwise
export const verifyToken = async (token: string): Promise<TokenClaims | null> => {
   try {
      const { payload } = await jwtVerify(token, chave(), { algorithms: [ALG], issuer: ISSUER, audience: AUDIENCE });
      if (typeof payload.sub !== "string" || typeof payload.ver !== "number") return null;
      return { usuarioId: payload.sub, sessaoVersao: payload.ver };
   } catch {
      return null;
   }
};
