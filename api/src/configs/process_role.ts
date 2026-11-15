// API_ROLE splits the pg-boss consumers out of the HTTP process:
//   all    (default) HTTP + producer + consumers in one process (development, single-process installs)
//   api    HTTP + producer only; jobs run in a separate worker process (src/worker.ts)
//   worker no HTTP; boss.work() consumers + sweep, supervised by the launcher
export type ProcessRole = "all" | "api" | "worker";

export function processRole(): ProcessRole {
   const v = (process.env.API_ROLE ?? "all").trim().toLowerCase();
   if (v === "api" || v === "worker" || v === "all") return v;
   console.warn(`unknown API_ROLE "${v}", using "all"`);
   return "all";
}
