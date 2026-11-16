import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NextFunction, Request, Response } from "express";

// Adaptive admission from polyvisor (erp-v1/supervisor), when the API runs under it. polyvisor puts the
// API in its own job object with a hard memory limit and hands it POLYVISOR_RUNTIME, a folder with its
// service-side runtime (plain ESM + polyvisor.node, a C++ addon reading the job, private bytes and system
// memory). The runtime turns those readings, event-loop delay, CPU time and route/query latency against
// baselines measured on a real deployment into a pressure level, and the middleware admits requests by it:
// health/auth always, interactive requests queued past a concurrency limit that shrinks under pressure,
// imports/exports/reports held when elevated and refused (503 + Retry-After) when critical.
//
// Loaded from disk at start (never bundled), so the ERP keeps no dependency on polyvisor: without the
// variable, or if the folder fails to load, the middleware is a pass-through and there are no samples.

type Level = "normal" | "elevated" | "critical";
type Middleware = (req: Request, res: Response, next: NextFunction) => void;
type Adaptive = {
   start(): void;
   stop(): void;
   readonly level: Level;
   observe(key: string, ms: number): void;
   middleware(o?: { classify?: (req: Request) => "critical" | "interactive" | "background" }): Middleware;
   samples(): Record<string, unknown>[];
};
type Runtime = {
   createAdaptive(o?: { onChange?: (level: Level, previous: Level, reasons: string[]) => void }): Adaptive;
   native: { backend: string; nativeError?: string | null };
};

// a real import() even where TypeScript compiles to CommonJS (tsc turns `import()` into require())
const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Runtime>;

let adaptive: Adaptive | null = null;
let middleware: Middleware | null = null;

/** loads the runtime when POLYVISOR_RUNTIME is set; resolves either way (the API never waits on it) */
export async function startAdaptive(
   log: (m: string) => void = (m) => console.log(`[adaptive] ${m}`),
   onLevel?: (level: Level, previous: Level) => void,
): Promise<void> {
   const dir = process.env.POLYVISOR_RUNTIME?.trim();
   if (!dir || adaptive) return;
   try {
      const runtime = await importEsm(pathToFileURL(join(dir, "index.js")).href);
      adaptive = runtime.createAdaptive({
         onChange: (level, previous, reasons) => {
            log(`${previous} → ${level}${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
            onLevel?.(level, previous);
         },
      });
      middleware = adaptive.middleware({ classify });
      adaptive.start();
      const why = runtime.native.nativeError ? ` (${runtime.native.nativeError})` : "";
      log(`admission on, readings from ${runtime.native.backend}${why}`);
   } catch (err) {
      log(`not loaded from ${dir}: ${err instanceof Error ? err.message : String(err)}`);
   }
}

export function stopAdaptive() {
   adaptive?.stop();
}

/** Express middleware: admission once the runtime is loaded, a pass-through before and without it */
export const adaptiveMiddleware: Middleware = (req, res, next) => (middleware ? middleware(req, res, next) : next());

/** the pressure level, "normal" when not running under polyvisor */
export const adaptiveLevel = (): Level => adaptive?.level ?? "normal";

/** latency of something with a measured baseline, e.g. "db select produtos" */
export function observeLatency(key: string, ms: number) {
   adaptive?.observe(key, ms);
}

/** "adaptive.pressure" samples for host telemetry (the TCC dashboard) */
export const adaptiveSamples = (): Record<string, unknown>[] => adaptive?.samples() ?? [];

// critical: liveness, auth (a user locked out by load is worse than a slow page); background: bulk work
// that can come back later; everything else interactive
function classify(req: Request): "critical" | "interactive" | "background" {
   const p = req.path;
   if (p === "/health" || p.startsWith("/auth") || p.startsWith("/login")) return "critical";
   if (/\/(import|importacoes|export|exportacoes|relatorios|reports|sync)\b/.test(p)) return "background";
   return "interactive";
}
