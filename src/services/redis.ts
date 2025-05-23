import { createClient } from "redis"
import { REDIS_URL } from "../utils/config"

const client = createClient({ url: REDIS_URL })

client.on("error", (err) => console.log('Redis Client Error', err))
client.on("connect", () => console.log('Redis connected...'))

export default client