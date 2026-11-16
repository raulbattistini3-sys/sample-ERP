import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// The ERP's shared settings, erp-v1/secrets/sample-erp.env (DATABASE_URL, DATABASE_CA_CERT, the vault's
// database): network dev and the launcher pass them in already; this covers `bun run dev` in api/ alone.
// Anything already in the environment (api/.env included) wins. ERP_SECRETS_DIR / TCC_SECRETS_DIR point
// at the folder; otherwise the first secrets/ holding generate.ts above the working directory.
function secretsDir(): string | null {
   const set = process.env.ERP_SECRETS_DIR?.trim() || process.env.TCC_SECRETS_DIR?.trim();
   if (set) return resolve(set);
   for (let d = process.cwd(); ; d = dirname(d)) {
      if (existsSync(join(d, "secrets", "generate.ts"))) return join(d, "secrets");
      if (dirname(d) === d) return null;
   }
}

const dir = secretsDir();
const file = dir && join(dir, "sample-erp.env");
if (file && existsSync(file)) {
   for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      const i = line.indexOf("=");
      if (!line || line.startsWith("#") || i <= 0) continue;
      const key = line.slice(0, i).trim();
      let value = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
      if (key === "DATABASE_CA_CERT" && value && !isAbsolute(value)) value = join(dir!, value);
      if (process.env[key] === undefined) process.env[key] = value;
   }
}
