import { sql } from "drizzle-orm";
import Config from "./configs/app_config";
import { vault } from "./integrations/vault/vault.client";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import router from "./routes";
import { corsOptions, origins } from "./configs/cors.config";
import { hostTelemetry } from "./utils/telemetry/telemetry";
import { adaptiveMiddleware } from "./utils/telemetry/adaptive";
import { openApiDocument } from "./docs/openapi";

const app = express();

// Express 5 defaults to the "simple" parser; keep nested params like ?categoria[nome]=x working for the product filters
app.set("query parser", "extended");

// first, so it times the whole request: http.request per matched route (never the raw URL) in host
// telemetry, and a Server-Timing header (app, db) the web's allowed origins can read
app.use(hostTelemetry.middleware({ timingAllowOrigin: origins }));
// then admission (under polyvisor): a shed request still shows up in telemetry, as a 503
app.use(adaptiveMiddleware);

// 100kb (the default) everywhere except the JSON spreadsheet import (up to 5000 products). Clientes
// spreadsheets are uploaded as files (multipart) to /clientes/importacoes, which this parser skips.
const IMPORT_PATHS = new Set(["/products/import"]);
const defaultJson = express.json();
const importJson = express.json({ limit: "2mb" });
app.use((req, res, next) => (IMPORT_PATHS.has(req.path) ? importJson : defaultJson)(req, res, next));
app.use(cors(corsOptions));
// before the router: everything past its public routes requires a token
// availability: "ok", or "degraded" when the vault is configured but not answering (usuarios still
// work; CPF / birth dates don't), "down" when the database doesn't answer
app.get("/health", async (_req, res) => {
   const [db, cofre] = await Promise.all([
      Config.getInstance().getDb().execute(sql`select 1`).then(() => "ok" as const, () => "down" as const),
      vault().saude(),
   ]);
   const status = db === "down" ? "down" : cofre === "degraded" ? "degraded" : "ok";
   res.status(status === "down" ? 503 : 200).json({ status, db, vault: cofre });
});
app.get("/openapi.json", (req, res) => res.json(openApiDocument));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use(router);

export { app };