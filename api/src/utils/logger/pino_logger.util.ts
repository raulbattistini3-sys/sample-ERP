import { HttpLogger, pinoHttp as pinoLog } from "pino-http";
import { ErrorLevelsEnum } from "../../enums/errors_enums/errors_levels.enum";
import LoggerInterface from "../../interfaces/logger_interfaces/logger_interface.interface";

class AppLogger implements LoggerInterface {
   private static instance: AppLogger;
   private readonly PinoInstance: HttpLogger;
   private readonly levelMap: Record<
      ErrorLevelsEnum,
      (obj: object, message?: string, ...args: any[]) => void
   >;
   constructor() {
      this.PinoInstance = pinoLog();
      this.levelMap = {
         DEBUG: this.PinoInstance.logger.debug.bind(this.PinoInstance.logger),
         INFO: this.PinoInstance.logger.info.bind(this.PinoInstance.logger),
         ERROR: this.PinoInstance.logger.error.bind(this.PinoInstance.logger),
         WARN: this.PinoInstance.logger.warn.bind(this.PinoInstance.logger),
         FATAL: this.PinoInstance.logger.fatal.bind(this.PinoInstance.logger),
      };
   }
   // one pino instance for the whole app, so every layer writes to the same stream
   public static getInstance(): AppLogger {
      if (!AppLogger.instance) {
         AppLogger.instance = new AppLogger();
      }
      return AppLogger.instance;
   }

   handle(
      obj: object,
      level: ErrorLevelsEnum,
      message?: string,
      ...args: any[]
   ) {
      (this.levelMap[level] || this.levelMap.ERROR)(obj, message, ...args);
   }
}

export default AppLogger;
