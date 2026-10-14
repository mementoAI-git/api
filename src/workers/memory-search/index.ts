import {Worker} from 'bullmq';
import type {RedisConnection} from '../../services/redis';
import {indexMemory} from '../../services/memory-search/indexing';
import type {MemorySearchJob} from '../../services/queues/memory-search';
import logger from '../../utils/logger';

export default function startMemorySearchWorker(connection: RedisConnection) {
  if (process.env.MEMORY_SEARCH_ENABLED !== 'true') return null;
  const worker = new Worker<MemorySearchJob>(
    'memory-description-search',
    job => indexMemory(job.data.user_id, job.data.memory_id),
    {connection, concurrency: 1},
  );
  worker.on('failed', () =>
    logger.warn(
      'Memory search preparation failed; word search remains available',
    ),
  );
  worker.on('error', () => logger.error('Memory search worker is unavailable'));
  return worker;
}
