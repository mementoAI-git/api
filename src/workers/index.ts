import 'dotenv/config';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { connectMongodb } from '../module/database/connection';
import { getRedisConnection } from '../services/redis';
import { extractBatchInsights, generateConversationSummary } from './insight';

async function startWorkers() {
  // Connect to database first
  await connectMongodb();

  const connection = getRedisConnection();

  // Insights extraction worker
  const insightsWorker = new Worker(
    'insights-extraction',
    async (job) => {
      const { user_id, exchanges } = job.data;

      await extractBatchInsights(user_id, exchanges);
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60000 }
    }
  );

  // Summarization worker
  const summarizationWorker = new Worker(
    'conversation-summarization',
    async (job) => {
      await generateConversationSummary(job.data?.memory_id);
    },
    {
      connection,
      concurrency: 1, // Process 1 at a time (summarization is heavier)
      limiter: {
        max: 5,
        duration: 60000
      }
    }
  );

  // Handle graceful shutdown
  const shutdown = async () => {

    await insightsWorker.close();
    await summarizationWorker.close();
    await mongoose.disconnect();

    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start the workers
startWorkers()
  .catch((error) => {
    console.error('Failed to start workers:', error);
    process.exit(1);
  });
