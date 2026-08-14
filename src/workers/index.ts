import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import {getRedisConnection} from '../services/redis';
import startInsightsExtractionWorker from './insight';
import startQuickCaptureWorker from './quick-capture';
import startSummarizationWorker from './summarizarion';
import startSystemWorker from './system';
import {logger} from '../utils';

async function startWorkers() {
  await connectMongodb();

  const connection = getRedisConnection();
  if (!connection) {
    throw new Error('Redis connection is unavailable');
  }

  logger.info('Starting background workers...');

  const insightsWorker = startInsightsExtractionWorker(connection);
  const quickCaptureWorker = startQuickCaptureWorker(connection);
  const summarizationWorker = startSummarizationWorker(connection);
  const systemWorker = startSystemWorker(connection);

  logger.info('Workers started');

  process.on('SIGTERM', async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      insightsWorker.close(),
      quickCaptureWorker.close(),
      summarizationWorker.close(),
      systemWorker.close(),
    ]);
    await mongoose.disconnect();
    process.exit(0); // eslint-disable-line n/no-process-exit
  });
}

startWorkers().catch(error => {
  logger.error({err: error}, 'Failed to start workers');
  process.exit(1); // eslint-disable-line n/no-process-exit
});
