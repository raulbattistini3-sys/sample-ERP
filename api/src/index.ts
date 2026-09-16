import { app } from "./app";
import PathParams from "node:path";
import Config from "./configs/app_config";
import BaseErrorMiddleware from "./middlewares/global_middleware.middleware";
import AppLogger from "./utils/logger/pino_logger.util";

const config = Config.getInstance();

const host = config.getApiConfig().host;
const port = config.getApiConfig().port;
const connection = config.getDb();
const pinoLogger = new AppLogger();
const baseErrorMiddleware = new BaseErrorMiddleware();
app.use(baseErrorMiddleware.handle);

app.listen(port, host, async () => {
  
  console.log("parou antes")
   pinoLogger.handle({ applicationValues: config }, "DEBUG");
   console.log(`Server listening on host: ${host} and port: ${port}`);
});
