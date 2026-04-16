import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import {getRedisConnection} from '../services/redis';
import startInsightsExtractionWorker from './insight';
import startSummarizationWorker from './summarizarion';
import startSystemWorker from './system';
import {logger} from '../utils';

async function startWorkers() {
  await connectMongodb();
  const connection = getRedisConnection();

  const insightsWorker = startInsightsExtractionWorker(connection);
  const summarizationWorker = startSummarizationWorker(connection);
  const systemWorker = startSystemWorker(connection);

  logger.info('Workers started');
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    await insightsWorker.close();
    await summarizationWorker.close();
    await systemWorker.close();
    await mongoose.disconnect();
    process.exit(0); // eslint-disable-line n/no-process-exit
  });
}

// Start the workers
startWorkers().catch(error => {
  console.error('Failed to start workers:', error);
  process.exit(1); // eslint-disable-line n/no-process-exit
});
