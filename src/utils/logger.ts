import pino from "pino";
import { NODE_ENV } from "./config";
import { compareStrings } from "./helpers";

const isProduction = compareStrings(NODE_ENV, 'production');

const loggerConfig: pino.LoggerOptions = {
  level: isProduction ? 'info' : 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    !isProduction && {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false
      },
    }
};

const logger = pino(loggerConfig);

export default logger;