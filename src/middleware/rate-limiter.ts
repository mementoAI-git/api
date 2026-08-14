import rateLimit from 'express-rate-limit';
import {responsHandler} from '../utils/helpers';
import RedisStore from 'rate-limit-redis';
import client, {getRedisConnection} from '../services/redis';
import logger from '../utils/logger';

export default function rateLimiter(window: number, max = 200) {
  const redisAvailable = Boolean(getRedisConnection());

  if (!redisAvailable) {
    logger.warn('Redis unavailable; using in-memory rate limiter fallback');
    return rateLimit({
      windowMs: window * 60 * 1000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_, response, __, options) => {
        return responsHandler(response, options.statusCode, options.message);
      },
    });
  }

  return rateLimit({
    windowMs: window * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_, response, __, options) => {
      return responsHandler(response, options.statusCode, options.message);
    },
    store: new RedisStore({
      sendCommand: (...args: string[]) => client.sendCommand(args),
    }),
  });
}
