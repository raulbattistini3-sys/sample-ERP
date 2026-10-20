import { app } from "./app";
import PathParams from "node:path";
import Config from "./configs/app_config";
import BaseErrorMiddleware from "./middlewares/global_middleware.middleware";
import AppLogger from "./utils/logger/pino_logger.util";
import { jiraDispatcher } from "./routes/integracao.routes";

const config = Config.getInstance();

const host = config.getApiConfig().host;
const port = config.getApiConfig().port;

const pinoLogger = AppLogger.getInstance();
const baseErrorMiddleware = new BaseErrorMiddleware(pinoLogger);
app.use(baseErrorMiddleware.handle);

app.listen(port, host, async () => {
   pinoLogger.handle({ applicationValues: config }, "DEBUG");
   console.log(`Server listening on host: ${host} and port: ${port}`);
   // sends the Jira issues queued for new auditorias
   jiraDispatcher.start();
});
