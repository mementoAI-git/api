import logger from '../utils/logger';
import {IRequest} from '../utils/interface';
import pinoHttpLogger from 'pino-http';
import pino from 'pino';
import {isEmpty, sanitizeData} from '../utils/helpers';
import {redactSensitiveQuery, sanitizeUrlForLogs} from '../utils/sanitize-url';

const ignorePaths = ['/health', '/favicon.ico', '/metrics'];

export const httpLogger = pinoHttpLogger({
  logger,
  autoLogging: {
    ignore: req => {
      return (
        req.url.startsWith('/docs') ||
        req.url.startsWith('/queues') ||
        req.url.startsWith('/assets') ||
        ignorePaths.includes(req.url || '')
      );
    },
  },
  wrapSerializers: false,
  serializers: {
    req: (req: IRequest) => {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ip =
        req.ip ||
        (typeof forwardedFor === 'string'
          ? forwardedFor.split(',')[0].trim()
          : undefined) ||
        (req.headers['x-real-ip'] as string) ||
        'unknown';

      const requestData: Record<string, any> = {
        method: req.method,
        url: sanitizeUrlForLogs(req.url),
        ip,
      };

      if (!isEmpty(req?.query)) {
        requestData.query = redactSensitiveQuery(
          sanitizeData(req.query) as Record<string, unknown>,
        );
      }
      if (!isEmpty(req?.params)) {
        requestData.params = sanitizeData(req.params);
      }
      if (!isEmpty(req?.auth?.id)) {
        requestData.user = req.auth?.id;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const body = req.body as Record<string, unknown> | undefined;
        if (body && typeof body === 'object' && 'password' in body) {
          requestData.body = {password: 'XXX'};
        }
      }

      return requestData;
    },
    res: () => undefined,
    err: pino.stdSerializers.err,
  },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500) return 'fatal';
    if (res.statusCode >= 400 || err) return 'error';
    if (res.statusCode >= 300) return 'warn';
    return 'info';
  },
});

export default httpLogger;
