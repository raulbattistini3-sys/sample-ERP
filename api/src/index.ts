import { app } from "./app";
import PathParams from "node:path";
import Config from "./configs/app_config";
import BaseErrorMiddleware from "./middlewares/global_middleware.middleware";
import AppLogger from "./utils/logger/pino_logger.util";
import { integracaoEnvioWorker } from "./routes/integracao.routes";

const config = Config.getInstance();

const host = config.getApiConfig().host;
const port = config.getApiConfig().port;

const pinoLogger = AppLogger.getInstance();
const baseErrorMiddleware = new BaseErrorMiddleware(pinoLogger);
app.use(baseErrorMiddleware.handle);

app.listen(port, host, async () => {
   pinoLogger.handle({ applicationValues: config }, "DEBUG");
   console.log(`Server listening on host: ${host} and port: ${port}`);
   // pg-boss worker that creates the Jira issues / monday items of new auditorias
   void integracaoEnvioWorker.start();
});

// let running jobs finish (up to 20s) and close pg-boss's connections, then exit
const shutdown = async () => {
   await integracaoEnvioWorker.stop();
   process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
