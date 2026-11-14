import { hash, parseOptions, verify } from "@node-rs/argon2";
import bcrypt from "bcrypt";

// Argon2id (RFC 9106) with OWASP's minimum profile: 19 MiB of memory, 2 passes, 1 lane. The PHC string
// it returns ($argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>) carries its own salt and parameters, so
// raising them later only needs needsRehash below.
// Algorithm is a const enum in the package's typings, which ts-node --transpile-only can't inline:
// 2 is Algorithm.Argon2id.
const ARGON2ID = 2;
const POLITICA = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => hash(plain, POLITICA);

// bcrypt ($2a$/$2b$/$2y$) is what every senha saved before Argon2id holds: still accepted, and replaced
// at the usuario's next sign-in (usuario.service.ts loginUsuario)
const isBcrypt = (stored: string) => /^\$2[aby]\$/.test(stored);

export const comparePassword = async (plain: string, stored: string): Promise<boolean> => {
   if (stored.startsWith("$argon2")) {
      try {
         return await verify(stored, plain);
      } catch {
         return false; // a malformed hash never matches
      }
   }
   if (isBcrypt(stored)) return bcrypt.compare(plain, stored);
   return false;
};

// true for a bcrypt hash or an Argon2 one made with other parameters than POLITICA
export const needsRehash = (stored: string): boolean => {
   if (!stored.startsWith("$argon2")) return true;
   try {
      const p = parseOptions(stored);
      return (
         p.algorithm !== POLITICA.algorithm ||
         p.memoryCost !== POLITICA.memoryCost ||
         p.timeCost !== POLITICA.timeCost ||
         p.parallelism !== POLITICA.parallelism
      );
   } catch {
      return true;
   }
};
