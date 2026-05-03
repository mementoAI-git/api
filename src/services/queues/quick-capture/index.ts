import {Queue} from 'bullmq';
import {getRedisConnection} from '../../redis';

export interface QuickCaptureEnrichmentJobData {
  user_id: string;
  memory_id: string;
  /** Hint from client: voice transcript may be unreliable */
  transcript_uncertain?: boolean;
}

const connection = getRedisConnection();

export const quickCaptureQueue = connection
  ? new Queue('quick-capture-enrichment', {connection})
  : null;

export async function queueQuickCaptureEnrichment(
  data: QuickCaptureEnrichmentJobData,
): Promise<void> {
  if (!quickCaptureQueue) {
    console.warn(
      'Quick capture queue not available, skipping enrichment job...',
    );
    return;
  }

  await quickCaptureQueue.add('enrich-quick-capture', data, {
    attempts: 3,
    backoff: {type: 'exponential', delay: 2000},
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}
