import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import router from "./routes";
import { corsOptions } from "./configs/cors.config";
import { openApiDocument } from "./docs/openapi";

const app = express();

// Express 5 defaults to the "simple" parser; keep nested params like ?categoria[nome]=x working for the product filters
app.set("query parser", "extended");

// 100kb (the default) everywhere except the spreadsheet import, which sends up to 5000 rows
const IMPORT_PATH = "/products/import";
const defaultJson = express.json();
const importJson = express.json({ limit: "2mb" });
app.use((req, res, next) => (req.path === IMPORT_PATH ? importJson : defaultJson)(req, res, next));
app.use(cors(corsOptions));
// before the router: everything past its public routes requires a token
app.get("/openapi.json", (req, res) => res.json(openApiDocument));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use(router);

export { app };