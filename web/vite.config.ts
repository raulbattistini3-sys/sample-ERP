import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// ../pkg: code shared with the API (tablecore: columnar table, search index, worker scheduler; telemetry)
const pkg = fileURLToPath(new URL("../pkg", import.meta.url));

// VITE_API_URL is baked into the bundle, so a build without it would ship an app that calls nowhere. Stop
// `vite` / `vite build` with status 1 instead (Node's os.Exit(1)), before anything is served or written.
function checkRequiredEnv(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const url = env.VITE_API_URL?.trim();
  let problem = "";
  if (!url) {
    problem = "VITE_API_URL is required: the API's address, e.g. http://localhost:3333, or /api behind the launcher's gateway (web/.env)";
  } else if (!url.startsWith("/") || url.startsWith("//")) {
    // a same-origin path ("/api", the launcher's gateway) needs no further check
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") problem = `VITE_API_URL must be http(s), got ${url}`;
    } catch {
      problem = `VITE_API_URL is not a URL: ${url}`;
    }
  }
  if (problem) {
    console.error(`[config] ${problem}`);
    process.exit(1);
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  checkRequiredEnv(mode);
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@pkg": pkg } },
    // the dev server only serves files under web/ unless told otherwise
    server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), pkg] } },
    // the search worker imports pkg modules, so it is bundled as an ES module worker
    worker: { format: "es" as const },
  };
})
