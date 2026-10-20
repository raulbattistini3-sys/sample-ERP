// Break-glass recovery: grants SU (default) or ADM to an existing usuario and reactivates them,
// straight through DATABASE_URL, without the API. Whoever can run this already controls the
// database, so it opens no new door, and unlike a permanent "su" account there's nothing to attack.
//
//   bun run admin:promote <email> [--role SU|ADM]
import "dotenv/config";
import { Pool } from "pg";

const ROLES = ["SU", "ADM"] as const;
type Role = (typeof ROLES)[number];

const usage = () => {
   console.error("usage: bun run admin:promote <email> [--role SU|ADM]");
   process.exit(1);
};

const args = process.argv.slice(2);
const roleFlag = args.findIndex((arg) => arg === "--role" || arg.startsWith("--role="));
let role: Role = "SU";
if (roleFlag !== -1) {
   const value = args[roleFlag].includes("=") ? args[roleFlag].split("=")[1] : args[roleFlag + 1];
   if (!ROLES.includes(value as Role)) usage();
   role = value as Role;
   args.splice(roleFlag, args[roleFlag].includes("=") ? 1 : 2);
}
const email = args[0]?.trim();
if (!email || args.length !== 1) usage();
if (!process.env.DATABASE_URL) {
   console.error("DATABASE_URL is not set (api/.env)");
   process.exit(1);
}

const pool = new Pool({
   connectionString: process.env.DATABASE_URL,
   ssl: { rejectUnauthorized: false },
});

try {
   // case-insensitive, like login and the usuarios_email_lower_unique index
   const { rows } = await pool.query(
      `update usuarios set permissoes = $2, ativo = true
        where lower(email) = lower($1)
        returning nome, email, permissoes::text as permissoes`,
      [email, role],
   );
   if (rows.length === 0) {
      console.error(`No usuario with email ${email}. Register one first (POST /user/register), then promote it.`);
      process.exitCode = 1;
   } else {
      const [usuario] = rows;
      console.log(`${usuario.nome} <${usuario.email}> is now ${usuario.permissoes} and active.`);
      console.log("If they're signed in, the change applies on their next request or page reload.");
   }
} finally {
   await pool.end();
}
