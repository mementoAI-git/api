import { Queue } from 'bullmq';
import { getRedisConnection } from '../../redis';
import redisClient from '../../redis';
import { parseJson } from '../../../utils/helpers';

// Types
export interface InsightsJobData {
  user_id: string;
  memory_id: string;
  exchanges: Array<{ user: string; ai: string }>;
}

interface ExchangeBuffer {
  user_id: string;
  memory_id: string;
  exchanges: Array<{ user: string; ai: string }>;
  lastUpdated: number;
}

const connection = getRedisConnection();

// Insights extraction queue
export const queue = connection
  ? new Queue('insights-extraction', { connection })
  : null;

// Redis keys
const BUFFER_PREFIX = 'insights:buffer:';
const BATCH_SIZE = 5;
const BATCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get buffer key for Redis
 */
function getBufferKey(userId: string, memoryId: string): string {
  return `${BUFFER_PREFIX}${userId}:${memoryId}`;
}

/**
 * Queue insights extraction job
 */
async function queueInsightsExtraction(data: InsightsJobData): Promise<void> {
  if (!queue) {
    console.warn('Insights queue not available, skipping...');
    return;
  }

  await queue.add('extract-insights', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 50
  });
}

/**
 * Flush buffer for a specific conversation to the queue
 */
async function flushInsightsBuffer(buffer: ExchangeBuffer): Promise<void> {
  try {
    if (buffer.exchanges.length === 0) return;

    // Queue the job
    await queueInsightsExtraction({
      user_id: buffer.user_id,
      memory_id: buffer.memory_id,
      exchanges: [...buffer.exchanges]
    });

    // Clear the buffer
    await redisClient.del(getBufferKey(buffer.user_id, buffer.memory_id));
  } catch (error) {
    console.error('Error flushing insights buffer:', error);
  }
}

async function flushStaleBuffers(): Promise<void> {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    const keys = await redisClient.keys(`${BUFFER_PREFIX}*`);
    const now = Date.now();

    for (const key of keys) {
      const existing = await redisClient.get(key);
      if (!existing) continue;

      const buffer: ExchangeBuffer = parseJson(existing as string);
      if (buffer.exchanges.length > 0 && (now - buffer.lastUpdated) > BATCH_TIMEOUT_MS) {
        await flushInsightsBuffer(buffer);
      }
    }
  } catch (error) {
    console.error('Error flushing stale buffers:', error);
  }
}

export async function addToInsightsBuffer(
  userId: string,
  memoryId: string,
  userMessage: string,
  aiResponse: string
): Promise<void> {
  const key = getBufferKey(userId, memoryId);

  try {
    // Ensure Redis is connected
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    // Get existing buffer or create new one
    const existing = await redisClient.get(key);
    let buffer: ExchangeBuffer;

    if (existing) {
      buffer = parseJson(existing as string);
    } else {
      buffer = {
        user_id: userId,
        memory_id: memoryId,
        exchanges: [],
        lastUpdated: Date.now()
      };
    }

    // Add new exchange
    buffer.exchanges.push({ user: userMessage, ai: aiResponse });
    buffer.lastUpdated = Date.now();

    // Save back to Redis with TTL (1 hour)
    await redisClient.setEx(key, 3600, JSON.stringify(buffer));

    // Check if we should flush
    if (buffer.exchanges.length >= BATCH_SIZE) {
      await flushInsightsBuffer(buffer);
    }
  } catch (error) {
    console.error('Error adding to insights buffer:', error);
  }
}
