import { Queue } from 'bullmq';
import { getRedisConnection } from '../../redis';
import { queueNames } from '../../../utils/constant';
import logger from '../../../utils/logger';

const connection = getRedisConnection();

// Summarization queue
export const summarizationQueue = connection
  ? new Queue(queueNames.summarization.id, { connection })
  : null;

export interface SummarizationJobData {
  memory_id: string;
}

export async function queueSummarization(memoryId: string, type: 'conversation' | 'story'): Promise<void> {
  if (!summarizationQueue) {
    return;
  }

  try {
    await summarizationQueue.add(
      queueNames.summarization.jobs[type],
      { memory_id: memoryId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );
    logger.info(`Queued summarization for memory ${memoryId}`);
  } catch (error) {
    logger.error(error, 'Error queueing summarization');
  }
}

export async function initializePersonaSummarization(): Promise<void> {
  if (!summarizationQueue) {
    logger.error('Summarization queue not available, cannot initialize recurring job');
    return;
  }

  await summarizationQueue.upsertJobScheduler(
    queueNames.summarization.jobs.persona,
    { pattern: "0 0 * * *" }, // Cron pattern: every 5 minutes to be changed to  0 0 * * *
    {
      opts: {
        removeOnComplete: 1,
        removeOnFail: 2
      }
    }
  )

  logger.debug('Initialized persona summarization recurring job (runs daily at midnight UTC)');
}

export async function initializeConversationSummary(): Promise<void> {
  if (!summarizationQueue) {
    logger.error('Summarization queue not available, cannot initialize recurring job');
    return;
  }

  await summarizationQueue.upsertJobScheduler(
    queueNames.summarization.jobs.memories,
    { pattern: "0 * * * *" }, // // Every hour at minute 0
    {
      opts: {
        removeOnComplete: 1,
        removeOnFail: 2
      }
    }
  )

  logger.debug('Initialized conversation summary recurring job (runs every 5 minutes)');
}

export async function queuePersonaBatchSummarization(
  cursor?: string,
  batchSize: number = 50,
  batchNumber: number = 1
): Promise<void> {
  if (!summarizationQueue) {
    logger.debug('Summarization queue not available, cannot queue persona batch');
    return;
  }

  try {
    await summarizationQueue.add(
      queueNames.summarization.jobs.persona,
      { cursor, batchSize, batchNumber },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 2,
        removeOnFail: 5
      }
    );
    logger.info(`Queued persona batch summarization: batch ${batchNumber}, cursor: ${cursor || 'none'}`);
  } catch (error) {
    logger.error(error, 'Error queueing persona batch summarization');
  }
}
