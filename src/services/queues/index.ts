import {Application} from 'express';
import {
  initializeConversationSummary,
  initializePersonaSummarization,
  summarizationQueue,
} from './summarization';
import {ExpressAdapter} from '@bull-board/express';
import {createBullBoard} from '@bull-board/api';
import {BullMQAdapter} from '@bull-board/api/bullMQAdapter';
import {insightQueue} from './insights';
import {
  initializeCapsuleReveal,
  initializeFileBackup,
  initializeResetStreak,
  initializeStalePendingRecovery,
  systemQueue,
} from './system';
import logger from '../../utils/logger';

export function setupBullBoard(app: Application) {
  const serverAdapter = new ExpressAdapter();

  const path = '/queues';

  serverAdapter.setBasePath(path);

  const queues = [summarizationQueue, insightQueue, systemQueue]
    .filter((queue): queue is NonNullable<typeof queue> => Boolean(queue))
    .map(queue => new BullMQAdapter(queue));

  if (queues.length === 0) {
    logger.warn('No BullMQ queues available; skipping queue dashboard setup');
    return;
  }

  createBullBoard({
    queues,
    serverAdapter,
  });

  app.use(path, serverAdapter.getRouter());
}

export async function initializeScheduler() {
  logger.info('Initializing scheduler...');

  const jobs = [
    ['reset streak', initializeResetStreak],
    ['file backup', initializeFileBackup],
    ['capsule reveal', initializeCapsuleReveal],
    ['stale pending recovery', initializeStalePendingRecovery],
    ['persona summarization', initializePersonaSummarization],
    ['conversation summary', initializeConversationSummary],
  ] as const;

  for (const [name, init] of jobs) {
    try {
      await init();
      logger.info({job: name}, 'Scheduler job initialized');
    } catch (error) {
      logger.error(
        {job: name, err: error},
        'Scheduler job initialization failed',
      );
    }
  }
}

export * from './insights';
export * from './summarization';
