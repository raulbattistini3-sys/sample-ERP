import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { app } from "./app";
import PathParams from "node:path";
import Config from "./configs/app_config";
import BaseErrorMiddleware from "./middlewares/global_middleware.middleware";
import AppLogger from "./utils/logger/pino_logger.util";
import { integracaoEnvioWorker } from "./routes/integracao.routes";
import { pagamentoRecorrenteWorker } from "./routes/cobranca.routes";
import { auditoriaConsolidacaoWorker } from "./routes/auditoria.routes";
import { importacaoCluster, importadorClient, productService } from "./routes/product.routes";
import { authMiddleware } from "./routes/auth_middleware.instance";
import { isAllowedOrigin } from "./configs/cors.config";
import { attachProductSocket } from "./sockets/produtos.socket";
import ErrorLevelsEnum from "./enums/errors_enums/errors_levels.enum";
import serializeError from "./utils/logger/serialize_error.util";
import { ensureBootstrapSu } from "./services/bootstrap_su";
import { apiEnv } from "./configs/database_connection";
import { listenWithFallback } from "./utils/listen_with_fallback";
import { anunciar, novoId, rede } from "./integrations/network/network.client";
import { apiTls } from "./configs/tls.config";
import { DevChildren } from "./dev/children";

const config = Config.getInstance();

const host = config.getApiConfig().host;
const port = config.getApiConfig().port;

const pinoLogger = AppLogger.getInstance();
const baseErrorMiddleware = new BaseErrorMiddleware(pinoLogger);
app.use(baseErrorMiddleware.handle);

// In development a taken port moves the API to the next free one (with a log line); in production the
// bind error stops the process, as the platform only routes to the port it gave.
// HTTPS with TLS 1.3 only when API_TLS_* are set (always in production): the browser and billing reach the
// API over it. Client certificates are asked for but optional, so browsers connect without one; billing's
// (CN billing, signed by API_TLS_CA) is what opens /internal/billing (requireClientCert).
const tls = apiTls();
const server = tls
   ? createHttpsServer(
        { cert: tls.cert, key: tls.key, ca: tls.ca, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.3" },
        app,
     )
   : createServer(app);
if (!tls) console.warn("API_TLS_* not set: serving plain HTTP, and billing can't reach /internal/billing (development only)");

// development: the importer, the vault and billing as this process's children (API_CHILDREN)
const children = DevChildren.fromEnv();
if (children && apiEnv() === "production") {
   console.warn("API_CHILDREN is ignored in production; the launcher or the container platform runs those services");
} else {
   children?.start();
}
listenWithFallback(server, { host, port, fallback: apiEnv() === "development", log: (m) => console.warn(m) }).then(
   async (bound) => {
      pinoLogger.handle({ applicationValues: config }, "DEBUG");
      console.log(`Server listening on host: ${host} and port: ${bound}`);
      // announce this API on the network service (NETWORK_URL): the gateway routes /api to it by name, at the
      // port actually bound, so a development port move needs no config change
      rede?.manter("api", novoId("api"), {
         address: anunciar(bound),
         version: process.env.npm_package_version,
         meta: { protocol: tls ? "https" : "http", env: apiEnv() },
      });
      // the first superuser of an empty database, when BOOTSTRAP_SU_* is set
      await ensureBootstrapSu(pinoLogger);
      // pg-boss worker that creates the Jira issues / HubSpot tickets of new auditorias
      void integracaoEnvioWorker.start();
      // issues each recurring payment's (Pagamento mensal) invoice on its date
      pagamentoRecorrenteWorker.start();
      // automatic auditorias, consolidated every AUDITORIAS_INTERVALO_MINUTOS (default 5)
      auditoriaConsolidacaoWorker.start();
      // the processes that run the imports queued in the importacoes table, when no Go importer is configured
      importacaoCluster?.start();
   },
   (error: Error) => {
      console.error(`Could not listen on host: ${host} and port: ${port}`, error);
      process.exit(1);
   },
);

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
   // leave the network first, so the gateway stops sending requests here while the rest winds down
   await rede?.sair();
   await Promise.all([integracaoEnvioWorker.stop(), pagamentoRecorrenteWorker.stop(), auditoriaConsolidacaoWorker.stop(), importacaoCluster?.stop(), closeProductSocket()]);
   importadorClient.close();
   // the children last: billing may still be sending its last notifications
   await children?.stop();
   process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
