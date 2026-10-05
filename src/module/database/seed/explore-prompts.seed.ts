import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../connection';
import Prompt from '../model/prompt';
import {ensureExploreIndexes} from '../explore-indexes';
import {EXPLORE_STARTER_QUESTIONS} from '../../api/prompt/explore-starter-questions';
import logger from '../../../utils/logger';

export async function seedExploreStarterQuestions() {
  if (EXPLORE_STARTER_QUESTIONS.length !== 110) {
    throw new Error('Explore starter seed must contain exactly 110 questions');
  }

  await ensureExploreIndexes();

  return Prompt.bulkWrite(
    EXPLORE_STARTER_QUESTIONS.map(question => ({
      updateOne: {
        filter: {stable_id: question.stable_id},
        update: {
          $set: {
            title: question.title,
            type: question.type,
            category: question.category,
            source: question.source,
            active: question.active,
            tags: question.tags,
          },
          $setOnInsert: {stable_id: question.stable_id},
        },
        upsert: true,
      },
    })),
  );
}

async function main() {
  await connectMongodb();
  const result = await seedExploreStarterQuestions();
  logger.info(
    {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      inserted: result.upsertedCount,
    },
    'Explore starter questions seeded',
  );
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async error => {
    logger.error(error, 'Explore starter seed failed');
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
