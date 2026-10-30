import {Queue} from 'bullmq';
import {getRedisConnection} from '../../redis';
import {searchPilotEnabled} from '../../memory-search/config';
import logger from '../../../utils/logger';

export type MemorySearchJob = {user_id: string; memory_id: string};
const connection =
  process.env.MEMORY_SEARCH_ENABLED === 'true' ? getRedisConnection() : null;
export const memorySearchQueue = connection
  ? new Queue<MemorySearchJob>('memory-description-search', {
      connection: {
        ...connection,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1000,
        commandTimeout: 1000,
      },
    })
  : null;
let queueReady = false;
// BullMQ must finish its Redis handshake before issuing metadata commands.
// Keep request handlers independent of that connection wait.
void memorySearchQueue
  ?.waitUntilReady()
  .then(client => {
    queueReady = true;
    client.on('close', () => (queueReady = false));
    client.on('ready', () => (queueReady = true));
  })
  .catch(() => {});
memorySearchQueue?.on('error', () =>
  logger.warn('Memory search queue is unavailable'),
);

/** Queue failure must never undo a saved memory or break ordinary search. */
export async function queueMemorySearch(
  userId: string,
  memoryId: string,
): Promise<boolean> {
  if (!searchPilotEnabled(userId) || !memorySearchQueue || !queueReady)
    return false;
  try {
    await memorySearchQueue.add(
      'prepare-memory',
      {user_id: userId, memory_id: memoryId},
      {
        jobId: `memory-${userId}-${memoryId}`,
        attempts: 3,
        backoff: {type: 'exponential', delay: 2000},
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return true;
  } catch {
    logger.warn('Memory search preparation could not be queued');
    return false;
  }
}
