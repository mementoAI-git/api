import { createClient } from "redis"
import { REDIS_URL } from "../utils/config"

const client = createClient({ url: REDIS_URL })

client.on("error", (err) => console.log('Redis Client Error', err))
client.on("connect", () => console.log('Redis connected...'))

export function getRedisConnection() {
  try {
    const url = new URL(REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
    };
  } catch (error) {
    console.error('Invalid REDIS_URL format:', error);
    return null;
  }
}

export default client