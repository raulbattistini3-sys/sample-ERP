import express from "express";
import cors from "cors";
import router from "./routes";
import { corsOptions } from "./configs/cors.config";

const app = express();

// Express 5 defaults to the "simple" parser; keep nested params like ?categoria[nome]=x working for the product filters
app.set("query parser", "extended");

app.use(express.json());
app.use(cors(corsOptions));
app.use(router);

export { app };