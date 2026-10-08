import {Queue} from 'bullmq';
import {getRedisConnection} from '../../redis';
import redisClient from '../../redis';
import {parseJson} from '../../../utils/helpers';

// Types
export interface InsightsJobData {
  user_id: string;
  memory_id?: string;
  profile_text?: string;
  discover_social_accounts?: boolean;
  exchanges?: Array<{user: string; ai: string}>;
}

interface ExchangeBuffer {
  user_id: string;
  memory_id: string;
  exchanges: Array<{user: string; ai: string}>;
  lastUpdated: number;
}

const connection = getRedisConnection();

// Insights extraction queue
export const insightQueue = connection
  ? new Queue('insights-extraction', {connection})
  : null;

// Redis keys
const BUFFER_PREFIX = 'insights:buffer:';
const BATCH_SIZE = 5;

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
  if (!insightQueue) {
    console.warn('Insights queue not available, skipping...');
    return;
  }

  await insightQueue.add('extract-insights', data, {
    attempts: 3,
    backoff: {type: 'exponential', delay: 1000},
    removeOnComplete: 100,
    removeOnFail: 50,
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
      exchanges: [...buffer.exchanges],
    });

    // Clear the buffer
    await redisClient.del(getBufferKey(buffer.user_id, buffer.memory_id));
  } catch (error) {
    console.error('Error flushing insights buffer:', error);
  }
}

export async function addToInsightsBuffer(
  userId: string,
  memoryId: string,
  userMessage: string,
  aiResponse: string,
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
        lastUpdated: Date.now(),
      };
    }

    // Add new exchange
    buffer.exchanges.push({user: userMessage, ai: aiResponse});
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

export async function queueStoryInsights(
  userId: string,
  memoryId: string,
): Promise<void> {
  if (!insightQueue) {
    console.warn(
      'Insights queue not available, skipping story insights extraction...',
    );
    return;
  }

  try {
    await queueInsightsExtraction({
      user_id: userId,
      memory_id: memoryId,
    });
  } catch (error) {
    console.error('Error queueing story insights extraction:', error);
  }
}

/** Bio ownership extraction stays off the request path, like story/chat enrichment. */
export async function queueProfileSocialAccounts(
  userId: string,
  text: string,
): Promise<void> {
  if (!/bluesky|bsky|twitter|\bx\b|youtube|linkedin|facebook/i.test(text))
    return;
  await queueInsightsExtraction({user_id: userId, profile_text: text});
}

export async function queueSocialAccountDiscovery(
  userId: string,
): Promise<void> {
  if (!insightQueue) return;
  const jobId = `social-discovery-${userId}`;
  const existing = await insightQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (
      state === 'completed' ||
      (state === 'failed' && Date.now() - existing.timestamp > 3600000)
    )
      await existing.remove();
    else return;
  }
  await insightQueue.add(
    'discover-social-accounts',
    {user_id: userId, discover_social_accounts: true},
    {
      jobId,
      attempts: 3,
      backoff: {type: 'exponential', delay: 5000},
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  );
}
