import {Queue} from 'bullmq';
import type {ExploreCategorySlug} from '../../../module/api/prompt/explore-taxonomy';
import {getRedisConnection} from '../../redis';
import logger from '../../../utils/logger';

export interface ExploreQuestionJobData {
  user_id: string;
  category: ExploreCategorySlug;
}

const connection = getRedisConnection();

export const exploreQuestionQueue = connection
  ? new Queue<ExploreQuestionJobData>('explore-question-generation', {
      connection,
    })
  : null;

export async function queueExploreQuestionRefill(
  data: ExploreQuestionJobData,
): Promise<void> {
  if (!exploreQuestionQueue) return;
  try {
    await exploreQuestionQueue.add('generate-explore-question', data, {
      jobId: `explore-${data.user_id}-${data.category}`,
      attempts: 2,
      backoff: {type: 'exponential', delay: 2000},
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (error) {
    logger.error(error, 'Unable to queue Explore question refill');
  }
}
