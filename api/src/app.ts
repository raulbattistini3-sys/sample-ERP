import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import router from "./routes";
import { corsOptions, origins } from "./configs/cors.config";
import { hostTelemetry } from "./utils/telemetry/telemetry";
import { openApiDocument } from "./docs/openapi";

const app = express();

// Express 5 defaults to the "simple" parser; keep nested params like ?categoria[nome]=x working for the product filters
app.set("query parser", "extended");

// first, so it times the whole request: http.request per matched route (never the raw URL) in host
// telemetry, and a Server-Timing header (app, db) the web's allowed origins can read
app.use(hostTelemetry.middleware({ timingAllowOrigin: origins }));

// 100kb (the default) everywhere except the JSON spreadsheet import (up to 5000 products). Clientes
// spreadsheets are uploaded as files (multipart) to /clientes/importacoes, which this parser skips.
const IMPORT_PATHS = new Set(["/products/import"]);
const defaultJson = express.json();
const importJson = express.json({ limit: "2mb" });
app.use((req, res, next) => (IMPORT_PATHS.has(req.path) ? importJson : defaultJson)(req, res, next));
app.use(cors(corsOptions));
// before the router: everything past its public routes requires a token
app.get("/openapi.json", (req, res) => res.json(openApiDocument));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use(router);

export { app };