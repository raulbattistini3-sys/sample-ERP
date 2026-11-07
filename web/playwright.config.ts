import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

// End-to-end tests against the whole stack behind the launcher's gateway (http://localhost:8080).
//   bun run e2e                     starts ../bin/sample-erp (build it with `cargo xtask dist`), or
//                                   reuses one already running
//   E2E_BASE_URL=... bun run e2e    against another deployment; nothing is started
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? "http://localhost:8080";
// web/ is an ES module package, so no __dirname
const launcher = fileURLToPath(new URL(`../bin/${process.platform === "win32" ? "sample-erp.exe" : "sample-erp"}`, import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  // the specs share one database and one admin; keep them in order
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        command: `"${launcher}"`,
        // /api/docs/, not /healthz: the gateway answers that before the API is up
        url: `${baseURL}/api/docs/`,
        reuseExistingServer: true,
        // the first launch downloads Postgres
        timeout: 300_000,
        env: { ERP_OPEN_BROWSER: "false" },
        stdout: "ignore",
      },
});
