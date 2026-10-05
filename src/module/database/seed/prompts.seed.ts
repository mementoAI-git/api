import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../connection';
import {seedExploreStarterQuestions} from './explore-prompts.seed';
import logger from '../../../utils/logger';

/** Backward-compatible seed entry point; the curated Explore catalog is canonical. */
async function seedPrompts() {
  await connectMongodb();
  const result = await seedExploreStarterQuestions();
  logger.info(
    {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      inserted: result.upsertedCount,
    },
    'Explore prompts seeded successfully',
  );
  await mongoose.disconnect();
}

seedPrompts().catch(async error => {
  logger.error(error, 'Error seeding Explore prompts');
  await mongoose.disconnect();
  process.exitCode = 1;
});
