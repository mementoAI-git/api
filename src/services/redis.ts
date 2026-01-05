import { createClient } from "redis"
import { REDIS_URL } from "../utils/config"
import logger from "../utils/logger"

const client = createClient({ url: REDIS_URL })

client.on("error", (err) => logger.error(err, 'Redis Client Error'))
client.on("connect", () => logger.info('Redis connected...'))

export default client