import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createHash, createHmac, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import react from '@vitejs/plugin-react-swc'
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ../pkg: code shared with the API (tablecore: columnar table, search index, worker scheduler; telemetry)
const pkg = fileURLToPath(new URL("../pkg", import.meta.url));

// VITE_API_URL is baked into the bundle, so a build without it would ship an app that calls nowhere. Stop
// `vite` / `vite build` with status 1 instead (Node's os.Exit(1)), before anything is served or written.
function checkRequiredEnv(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const url = env.VITE_API_URL?.trim();
  let problem = "";
  if (!url) {
    problem = "VITE_API_URL is required: the API's address, e.g. https://localhost:3333, or /api behind the launcher's gateway (web/.env)";
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

// The dev server joins the network service (network/, Go) as "web" when NETWORK_URL and NETWORK_TOKEN are
// set: the gateway then serves the app from here (HMR included) at whatever port vite ended up on, next to
// /api and /billing, with no address in any config. Calls are signed like network/registry/sign.go.
function networkRegistration(env: Record<string, string | undefined>): Plugin {
  const base = env.NETWORK_URL?.trim().replace(/\/$/, "");
  const token = env.NETWORK_TOKEN;
  const sign = (method: string, path: string, body: string) => {
    const t = String(Math.floor(Date.now() / 1000));
    const n = randomBytes(12).toString("hex");
    const sum = createHash("sha256").update(body).digest("hex");
    const sig = createHmac("sha256", token!).update(`${t}
${n}
${method}
${path}
${sum}`).digest("hex");
    return `t=${t},n=${n},s=${sig}`;
  };
  const call = (method: string, path: string, payload?: unknown) => {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    return fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Network-Signature": sign(method, path, body) },
      body: payload === undefined ? undefined : body,
      signal: AbortSignal.timeout(3000),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  };
  return {
    name: "erp-network-registration",
    apply: "serve",
    configureServer(server) {
      if (!base || !token) return;
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") return;
        const host = env.NETWORK_ADVERTISE_HOST?.trim() || "127.0.0.1";
        const id = env.NETWORK_INSTANCE_ID?.trim() || `web-${hostname().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 24)}-${randomBytes(4).toString("hex")}`;
        const path = `/registry/web/${id}`;
        const scheme = server.config.server.https ? "https" : "http";
        const reg = { address: `${scheme}://${host}:${address.port}`, health: "/", meta: { protocol: scheme, dev: "vite" }, ttlSeconds: 15 };
        let ok: boolean | null = null;
        const beat = () =>
          call("PUT", path, reg).then(
            () => {
              if (ok !== true) server.config.logger.info(`[network] registered as web/${id} at ${reg.address}`);
              ok = true;
            },
            (error: Error) => {
              if (ok !== false) server.config.logger.warn(`[network] registration failed; retrying: ${error.message}`);
              ok = false;
            },
          );
        void beat();
        const timer = setInterval(beat, 5000);
        timer.unref();
        server.httpServer?.once("close", () => {
          clearInterval(timer);
          void call("DELETE", path).catch(() => undefined);
        });
      });
    },
  };
}

// HTTPS, TLS 1.3 only, for the dev server: WEB_TLS_CERT / WEB_TLS_KEY, defaulting to the certificate
// `bun run secrets` writes (secrets/tls/web.crt, names localhost). Without either the server stays on HTTP.
// The browser trusts it once the internal CA (secrets/tls/ca.crt) is imported, see the README.
// Relative paths are tried from web/ and then from the repo root, so both ../secrets/tls/web.crt and
// secrets/tls/web.crt work. A path that is set but missing is an error, not a silent fall back to HTTP.
const web = fileURLToPath(new URL(".", import.meta.url));
function caminho(value: string | undefined, fallback: string, key: string): string | null {
  const v = value?.trim();
  if (!v) return existsSync(fallback) ? fallback : null;
  for (const base of [web, resolve(web, "..")]) {
    const full = resolve(base, v);
    if (existsSync(full)) return full;
  }
  console.error(`[config] ${key}=${v} does not exist (tried from web/ and from the repo root)`);
  process.exit(1);
}
function devHttps(env: Record<string, string | undefined>) {
  const cert = caminho(env.WEB_TLS_CERT, fileURLToPath(new URL("../secrets/tls/web.crt", import.meta.url)), "WEB_TLS_CERT");
  const key = caminho(env.WEB_TLS_KEY, fileURLToPath(new URL("../secrets/tls/web.key", import.meta.url)), "WEB_TLS_KEY");
  if (!cert || !key) return undefined;
  return { cert: readFileSync(cert), key: readFileSync(key), minVersion: "TLSv1.3" as const };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  checkRequiredEnv(mode);
  const env = { ...loadEnv(mode, process.cwd(), ["VITE_", "NETWORK_", "WEB_"]), ...process.env };
  return {
    plugins: [react(), tailwindcss(), networkRegistration(env)],
    resolve: { alias: { "@pkg": pkg } },
    // the dev server only serves files under web/ unless told otherwise
    // 127.0.0.1, not "localhost": Node/Bun may bind localhost to ::1 only, and then the network service
    // (which registers and probes 127.0.0.1:5173) never reaches it. WEB_HOST overrides (0.0.0.0 to reach it from another machine).
    server: { host: env.WEB_HOST?.trim() || "127.0.0.1", port: 5173, https: devHttps(env), fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), pkg] } },
    // the search worker imports pkg modules, so it is bundled as an ES module worker
    worker: { format: "es" as const },
  };
})
