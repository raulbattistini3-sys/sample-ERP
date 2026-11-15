import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { WindowLog } from "./window-log";

// Development only: the API starts the importer, the vault, billing and the TCC as its own child
// processes, so one `go run ./network/cmd/network dev` (network -> web, api -> importer, vault, billing,
// tcc) brings the whole stack up in one terminal and Ctrl+C brings it down.
//
//   API_CHILDREN        which ones: "importer,vault,billing,tcc" (any subset; empty = none, the default)
//   TCC_DIR             the TCC pnpm workspace (default: tcc-v2/tcc-v1/demo-monorepo-workspace found above)
//   TCC_SECRETS_DIR     where tcc-server.env is (default: the secrets/ folder found above, erp-v1/secrets)
//   API_CHILDREN_ROOT   the repo root (default: the folder above the API's cwd)
//
// Each child runs in its own folder with that folder's .env added to its environment (the importer and
// billing also read it themselves), and every line it prints comes out here as "[name] ...".
// Stopping: the children get SIGTERM (their process group, on Linux/macOS) and up to 20 s to finish, then
// are killed with everything they started. On Windows Ctrl+C already reaches every process in the console,
// and what is still alive after the wait is ended with `taskkill /T /F` (go run's compiled binary and
// Maven's JVM included). A run that ended abruptly (ts-node-dev respawn on Windows) leaves its pids in a
// file in the temp folder, and the next start ends those first, so ports are never left taken.

const WIN = process.platform === "win32";
const GRACE_MS = 20_000;

type Spec = { cwd: string; command: string; args: string[]; env?: Record<string, string> };

// KEY=value lines; enough for the .env files of this repo (no multi-line values)
export function parseEnvFile(path: string): Record<string, string> {
   if (!existsSync(path)) return {};
   const out: Record<string, string> = {};
   for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i <= 0) continue;
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      out[line.slice(0, i).trim()] = value;
   }
   return out;
}

// postgresql://user:pass@host:port/db?x=y  ->  jdbc:postgresql://host:port/db?x=y&user=...&password=...
export function toJdbcUrl(url: string): string {
   const u = new URL(url);
   const params = new URLSearchParams(u.search);
   if (u.username) params.set("user", decodeURIComponent(u.username));
   if (u.password) params.set("password", decodeURIComponent(u.password));
   const q = params.toString();
   return `jdbc:postgresql://${u.host}${u.pathname}${q ? `?${q}` : ""}`;
}

const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");

// <ancestor>/<rel> for the first folder from `from` upwards that has it
function findUp(from: string, rels: string[], probe: string): string | null {
   for (let d = resolve(from); ; d = dirname(d)) {
      for (const rel of rels) if (existsSync(join(d, rel, probe))) return join(d, rel);
      if (dirname(d) === d) return null;
   }
}

// the TCC pnpm workspace (TCC_DIR, or tcc-v2/tcc-v1/demo-monorepo-workspace beside the ERP in erp-v1)
export function tccWorkspace(root: string): string | null {
   if (process.env.TCC_DIR?.trim()) return resolve(process.env.TCC_DIR.trim());
   return findUp(root, ["tcc-v2/tcc-v1/demo-monorepo-workspace", "tcc-v1/demo-monorepo-workspace"], "pnpm-workspace.yaml");
}

// erp-v1/secrets (TCC_SECRETS_DIR, or the secrets/ folder holding generate.ts above the ERP)
export function secretsDir(root: string): string | null {
   if (process.env.TCC_SECRETS_DIR?.trim()) return resolve(process.env.TCC_SECRETS_DIR.trim());
   return findUp(root, ["secrets"], "generate.ts");
}

function specs(root: string): Record<string, Spec> {
   const tccDir = tccWorkspace(root);
   const secrets = secretsDir(root);
   return {
      // the TCC: `pnpm run dev` at the workspace root starts its server (apps/server) and its dashboard
      // (apps/web, vite) together. Its settings come from erp-v1/secrets/tcc-server.env, handed down here
      // so nothing the API inherited overrides them; both join the network as "tcc" and "tcc-web".
      ...(tccDir && {
         tcc: {
            cwd: tccDir,
            command: "pnpm",
            args: ["run", "dev"],
            env: { ...(secrets ? { TCC_SECRETS_DIR: secrets, ...parseEnvFile(join(secrets, "tcc-server.env")) } : {}) },
         },
      }),
      importer: { cwd: join(root, "importer"), command: "go", args: ["run", "./cmd/importer"] },
      vault: {
         cwd: join(root, "vault"),
         command: "go",
         args: ["run", "./cmd/vault", "serve"],
         // the vault needs only the token's digest; derived from the API's VAULT_TOKEN when vault/.env has none
         env: process.env.VAULT_TOKEN ? { VAULT_TOKEN_SHA256: sha256Hex(process.env.VAULT_TOKEN) } : {},
      },
      // billing reads JDBC only: the ERP's one DATABASE_URL (secrets/sample-erp.env), rewritten
      billing: {
         cwd: join(root, "billing"),
         command: WIN ? "mvnw.cmd" : "./mvnw",
         args: ["spring-boot:run", "-e"],
         env: process.env.DATABASE_URL ? { JDBC_DATABASE_URL: toJdbcUrl(process.env.DATABASE_URL) } : {},
      },
   };
}

type Running = { name: string; proc: ChildProcess; exited: Promise<void>; log?: WindowLog };

// children whose output goes to 5-minute files (window-log.ts) under <repo>/logs/<name>/ instead of the
// terminal; only lines that look like errors or warnings still show up there
const FILE_LOGGED = new Set(["tcc"]);
const ALARM = /error|warn|fail|exception|panic|EADDRINUSE/i;

// a tree-kill that works with a dead parent too (Windows: taskkill /T walks from the pid down)
function killTree(pid: number) {
   try {
      if (WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-pid, "SIGKILL");
   } catch {
      /* already gone */
   }
}

export class DevChildren {
   private readonly running: Running[] = [];
   private stopping = false;
   private readonly pidFile: string;

   constructor(
      private readonly names: string[],
      private readonly root: string,
      private readonly apiEnvKeys: Set<string>,
   ) {
      this.pidFile = join(tmpdir(), `sample-erp-api-children-${sha256Hex(root).slice(0, 12)}.json`);
   }

   static fromEnv(): DevChildren | null {
      const names = (process.env.API_CHILDREN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length === 0) return null;
      const root = resolve(process.env.API_CHILDREN_ROOT?.trim() || join(process.cwd(), ".."));
      // the keys api/.env put into this process: not handed down, so PORT, DATABASE_URL & co. of the API
      // never override a child's own settings
      const apiKeys = new Set(Object.keys(parseEnvFile(join(process.cwd(), ".env"))));
      return new DevChildren(names, root, apiKeys);
   }

   start() {
      this.reapLeftovers();
      const all = specs(this.root);
      for (const name of this.names) {
         const spec = all[name];
         if (!spec) {
            console.warn(
               name === "tcc"
                  ? `[api] API_CHILDREN: no TCC workspace found above ${this.root} (set TCC_DIR to tcc-v2/tcc-v1/demo-monorepo-workspace)`
                  : `[api] API_CHILDREN: unknown "${name}" (importer, vault, billing, tcc)`,
            );
            continue;
         }
         this.spawn(name, spec);
      }
      this.savePids();
   }

   private baseEnv(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(process.env)) if (!this.apiEnvKeys.has(k)) env[k] = v;
      // every child joins the same network the API is on
      for (const k of ["NETWORK_URL", "NETWORK_TOKEN"]) if (process.env[k]) env[k] = process.env[k];
      return env;
   }

   private spawn(name: string, spec: Spec) {
      const env = { ...this.baseEnv(), ...(spec.env ?? {}), ...parseEnvFile(join(spec.cwd, ".env")) };
      const proc = spawn(spec.command, spec.args, {
         cwd: spec.cwd,
         env,
         stdio: ["ignore", "pipe", "pipe"],
         // own process group on Linux/macOS, so SIGTERM reaches go run's binary and Maven's JVM too
         detached: !WIN,
         // .cmd files need a shell on Windows
         shell: WIN,
         windowsHide: true,
      });
      const prefix = `[${name}]`;
      const log = FILE_LOGGED.has(name) ? new WindowLog(join(this.root, "logs", name), name) : undefined;
      if (log) console.log(`[api] ${name} output: ${log.dir} (one gzipped file per 5 minutes; errors/warnings also here)`);
      for (const stream of [proc.stdout, proc.stderr]) {
         if (!stream) continue;
         createInterface({ input: stream }).on("line", (line) => {
            if (log) {
               log.write(line);
               if (!ALARM.test(line)) return;
            }
            process.stdout.write(`${prefix} ${line}\n`);
         });
      }
      const exited = new Promise<void>((done) => {
         proc.once("exit", (code, signal) => {
            if (!this.stopping) console.warn(`${prefix} exited (${signal ?? `code ${code}`}); the API keeps running without it`);
            done();
         });
         proc.once("error", (error) => {
            console.error(`${prefix} could not start ${spec.command}: ${error.message}`);
            done();
         });
      });
      console.log(`[api] started ${name}: ${spec.command} ${spec.args.join(" ")} (in ${spec.cwd})`);
      this.running.push({ name, proc, exited, log });
   }

   async stop() {
      if (this.stopping) return;
      this.stopping = true;
      for (const { proc } of this.running) {
         if (proc.exitCode !== null || !proc.pid) continue;
         try {
            if (!WIN) process.kill(-proc.pid, "SIGTERM");
         } catch {
            /* gone */
         }
      }
      const all = Promise.all(this.running.map((r) => r.exited));
      const timedOut = await Promise.race([all.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), GRACE_MS).unref())]);
      if (timedOut) console.warn(`[api] children still running after ${GRACE_MS / 1000}s; killing them`);
      // whatever is left (on Windows the go/maven processes under the shell) goes with its tree
      for (const { proc } of this.running) if (proc.pid) killTree(proc.pid);
      rmSync(this.pidFile, { force: true });
      // the last window of each file-logged child gets compressed too
      await Promise.all(this.running.map((r) => r.log?.close()));
   }

   private savePids() {
      const pids = this.running.map((r) => r.proc.pid).filter((p): p is number => !!p);
      try {
         writeFileSync(this.pidFile, JSON.stringify(pids));
      } catch {
         /* best effort */
      }
   }

   private reapLeftovers() {
      if (!existsSync(this.pidFile)) return;
      try {
         const pids = JSON.parse(readFileSync(this.pidFile, "utf8")) as number[];
         for (const pid of pids) killTree(pid);
         if (pids.length) console.warn(`[api] ended ${pids.length} child process(es) left by the previous run`);
      } catch {
         /* unreadable: ignore */
      }
      rmSync(this.pidFile, { force: true });
   }
}
