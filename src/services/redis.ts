import {createClient, RedisClientType} from 'redis';
import {REDIS_URL} from '../utils/config';
import logger from '../utils/logger';

export interface RedisConnection {
  host: string;
  port: number;
  password?: string;
  username?: string;
}

const client: RedisClientType = createClient({
  url: REDIS_URL || undefined,
});

client.on('error', err => logger.error(err, 'Redis Client Error'));
client.on('connect', () => logger.info('Redis connected...'));

export function getRedisConnection(): RedisConnection | null {
  if (!REDIS_URL) {
    logger.warn(
      'REDIS_URL is not configured; Redis-backed jobs and rate limiting will be disabled',
    );
    return null;
  }

  try {
    const url = new URL(REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
    };
  } catch (error) {
    logger.error({err: error}, 'Invalid REDIS_URL format');
    return null;
  }
}

export default client;
