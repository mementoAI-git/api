import {Worker} from 'bullmq';
import type {RedisConnection} from '../../services/redis';
import {generateAndStoreExploreQuestion} from '../../module/api/prompt/explore-personalization';
import type {ExploreQuestionJobData} from '../../services/queues/explore-questions';
import logger from '../../utils/logger';

export default function startExploreQuestionWorker(
  connection: RedisConnection,
) {
  return new Worker<ExploreQuestionJobData>(
    'explore-question-generation',
    async job => {
      const {user_id, category} = job.data;
      let created = 0;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const question = await generateAndStoreExploreQuestion(
          user_id,
          category,
        );
        if (!question) break;
        created += 1;
      }
      logger.info(
        {user_id, category, created},
        'Explore question refill processed',
      );
    },
    {
      connection,
      concurrency: 2,
      limiter: {max: 10, duration: 60_000},
    },
  );
}
