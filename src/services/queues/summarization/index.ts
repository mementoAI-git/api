import { Queue } from 'bullmq';
import { getRedisConnection } from '../../redis';

const connection = getRedisConnection();

// Summarization queue
export const summarizationQueue = connection
  ? new Queue('conversation-summarization', { connection })
  : null;

export interface SummarizationJobData {
  memory_id: string;
}

export async function queueSummarization(memoryId: string): Promise<void> {
  if (!summarizationQueue) {
    console.warn('Summarization queue not available, skipping...');
    return;
  }

  try {
    await summarizationQueue.add('summarize-conversation', { memory_id: memoryId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    console.log(`Queued summarization for memory ${memoryId}`);
  } catch (error) {
    console.error('Error queueing summarization:', error);
  }
}
