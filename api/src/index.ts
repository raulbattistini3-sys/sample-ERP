import { app } from "./app";
import PathParams from "node:path";
import Config from "./configs/app_config";
import BaseErrorMiddleware from "./middlewares/global_middleware.middleware";
import AppLogger from "./utils/logger/pino_logger.util";
import { integracaoEnvioWorker } from "./routes/integracao.routes";
import { importacaoCluster, importadorClient, productService } from "./routes/product.routes";
import { authMiddleware } from "./routes/auth_middleware.instance";
import { isAllowedOrigin } from "./configs/cors.config";
import { attachProductSocket } from "./sockets/produtos.socket";
import ErrorLevelsEnum from "./enums/errors_enums/errors_levels.enum";
import serializeError from "./utils/logger/serialize_error.util";
import { ensureBootstrapSu } from "./services/bootstrap_su";

const config = Config.getInstance();

const host = config.getApiConfig().host;
const port = config.getApiConfig().port;

const pinoLogger = AppLogger.getInstance();
const baseErrorMiddleware = new BaseErrorMiddleware(pinoLogger);
app.use(baseErrorMiddleware.handle);

// Express 5 hands bind errors (EADDRINUSE, EACCES) to this callback instead of throwing
const server = app.listen(port, host, async (error?: Error) => {
   if (error) {
      console.error(`Could not listen on host: ${host} and port: ${port}`, error);
      process.exit(1);
   }
   pinoLogger.handle({ applicationValues: config }, "DEBUG");
   console.log(`Server listening on host: ${host} and port: ${port}`);
   // the first superuser of an empty database, when BOOTSTRAP_SU_* is set
   await ensureBootstrapSu(pinoLogger);
   // pg-boss worker that creates the Jira issues / HubSpot tickets of new auditorias
   void integracaoEnvioWorker.start();
   // the processes that run the imports queued in the importacoes table, when no Go importer is configured
   importacaoCluster?.start();
});

// The product list over a WebSocket, on this same port (path /ws). If the runtime can't host it, REST
// keeps working and the web falls back to it.
let closeProductSocket: () => Promise<void> = async () => {};
try {
   closeProductSocket = attachProductSocket(server, {
      resolveSession: authMiddleware.resolveSession,
      getProductsScroll: (...args) => productService.getProductsScroll(...args),
      logger: pinoLogger,
      isAllowedOrigin,
   });
} catch (err) {
   pinoLogger.handle({ layer: "socket", error: serializeError(err) }, ErrorLevelsEnum.Values.ERROR, "product socket unavailable; REST only");
}

// let running jobs finish (up to 20s) and close pg-boss's connections, then exit
const shutdown = async () => {
   await Promise.all([integracaoEnvioWorker.stop(), importacaoCluster?.stop(), closeProductSocket()]);
   importadorClient.close();
   process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
