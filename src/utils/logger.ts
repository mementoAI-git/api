import pino from 'pino';
import {NODE_ENV} from './config';

const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

const loggerConfig: pino.LoggerOptions = {
  level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: !isProduction && !isTest && {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  },
};

const logger = pino(loggerConfig);
export default logger;
