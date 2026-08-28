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

export async function getCachedJson<T>(key: string): Promise<T | null> {
  if (!client.isReady) return null;
  try {
    const value = await client.get(key);
    return typeof value === 'string' ? (JSON.parse(value) as T) : null;
  } catch (error) {
    logger.warn({err: error, key}, 'Redis cache read failed; using fallback');
    return null;
  }
}

export async function setCachedJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!client.isReady) return;
  try {
    await client.set(key, JSON.stringify(value), {EX: ttlSeconds});
  } catch (error) {
    logger.warn({err: error, key}, 'Redis cache write failed');
  }
}

export async function deleteCacheValue(key: string): Promise<void> {
  if (!client.isReady) return;
  try {
    await client.del(key);
  } catch (error) {
    logger.warn({err: error, key}, 'Redis cache invalidation failed');
  }
}

export default client;
