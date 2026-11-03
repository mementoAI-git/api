// Loads .env first; under PM2 the file wins over stale copies (see load-env).
import '../utils/load-env';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import {getRedisConnection} from '../services/redis';
import startInsightsExtractionWorker from './insight';
import startQuickCaptureWorker from './quick-capture';
import startSummarizationWorker from './summarizarion';
import startSystemWorker from './system';
import startExploreQuestionWorker from './explore-questions';
import startMemorySearchWorker from './memory-search';
import {logger} from '../utils';
import {startReadyWorkerHeartbeat} from '../services/worker-heartbeat';
import {warmUpEmbeddings} from '../services/embeddings';
import {startGrowthAnalytics} from '../services/growth-analytics';

async function startWorkers() {
  await connectMongodb();

  const connection = getRedisConnection();
  if (!connection) {
    throw new Error('Redis connection is unavailable');
  }

  logger.info('Starting background workers...');
  // The embedding sweep runs here; load the model before its first run.
  warmUpEmbeddings(error =>
    logger.warn({err: error}, 'Memory embedding model failed to load'),
  );

  const insightsWorker = startInsightsExtractionWorker(connection);
  const quickCaptureWorker = startQuickCaptureWorker(connection);
  const summarizationWorker = startSummarizationWorker(connection);
  const systemWorker = startSystemWorker(connection);
  const workers = [
    insightsWorker,
    quickCaptureWorker,
    summarizationWorker,
    systemWorker,
    startExploreQuestionWorker(connection),
  ];
  const memorySearchWorker = startMemorySearchWorker(connection);
  if (memorySearchWorker) workers.push(memorySearchWorker);
  const heartbeat = await startReadyWorkerHeartbeat(
    workers,
    undefined,
    error => {
      logger.error(error, 'Queue worker became unavailable; restarting');
      process.exit(1); // eslint-disable-line n/no-process-exit
    },
  );

  logger.info('Workers started');
  const stopGrowthAnalytics = startGrowthAnalytics();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down workers...');
    await heartbeat.stop();
    await Promise.all(workers.map(worker => worker.close()));
    await stopGrowthAnalytics();
    await mongoose.disconnect();
    process.exit(0); // eslint-disable-line n/no-process-exit
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

startWorkers().catch(error => {
  logger.error({err: error}, 'Failed to start workers');
  process.exit(1); // eslint-disable-line n/no-process-exit
});
