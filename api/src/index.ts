import { app } from "./app";
import PathParams from "node:path";
import Config from "./configs/app_config";
import BaseErrorMiddleware from "./middlewares/global_middleware.middleware";
import AppLogger from "./utils/logger/pino_logger.util";
import { integracaoEnvioWorker } from "./routes/integracao.routes";
import { importacaoCluster, importadorClient } from "./routes/product.routes";

const config = Config.getInstance();

const host = config.getApiConfig().host;
const port = config.getApiConfig().port;

const pinoLogger = AppLogger.getInstance();
const baseErrorMiddleware = new BaseErrorMiddleware(pinoLogger);
app.use(baseErrorMiddleware.handle);

// Express 5 hands bind errors (EADDRINUSE, EACCES) to this callback instead of throwing
app.listen(port, host, async (error?: Error) => {
   if (error) {
      console.error(`Could not listen on host: ${host} and port: ${port}`, error);
      process.exit(1);
   }
   pinoLogger.handle({ applicationValues: config }, "DEBUG");
   console.log(`Server listening on host: ${host} and port: ${port}`);
   // pg-boss worker that creates the Jira issues / HubSpot tickets of new auditorias
   void integracaoEnvioWorker.start();
   // the processes that run the imports queued in the importacoes table, when no Go importer is configured
   importacaoCluster?.start();
});

// let running jobs finish (up to 20s) and close pg-boss's connections, then exit
const shutdown = async () => {
   await Promise.all([integracaoEnvioWorker.stop(), importacaoCluster?.stop()]);
   importadorClient.close();
   process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
