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
  initializeAccountPurgeDispatcher,
  initializeFileBackup,
  initializeResetStreak,
  initializeStalePendingRecovery,
  initializeStorageReservationExpiry,
  initializeBillingUsageReconciliation,
  initializeStoreNotificationDispatcher,
  initializeArchiveExportDispatcher,
  systemQueue,
} from './system';
import logger from '../../utils/logger';
import {BULL_BOARD_ENABLED} from '../../utils/config';
import gaurd from '../../middleware/gaurd';
import {requireAdmin} from '../../middleware/admin';
import {exploreQuestionQueue} from './explore-questions';

export function setupBullBoard(app: Application): boolean {
  if (!BULL_BOARD_ENABLED) {
    logger.info('Bull Board is disabled');
    return false;
  }

  const serverAdapter = new ExpressAdapter();

  const path = '/queues';

  serverAdapter.setBasePath(path);

  const queues = [
    summarizationQueue,
    insightQueue,
    systemQueue,
    exploreQuestionQueue,
  ]
    .filter((queue): queue is NonNullable<typeof queue> => Boolean(queue))
    .map(queue => new BullMQAdapter(queue));

  if (queues.length === 0) {
    logger.warn('No BullMQ queues available; skipping queue dashboard setup');
    return false;
  }

  createBullBoard({
    queues,
    serverAdapter,
  });

  app.use(path, gaurd, requireAdmin, serverAdapter.getRouter());
  return true;
}

export async function initializeScheduler() {
  logger.info('Initializing scheduler...');

  const jobs = [
    ['reset streak', initializeResetStreak],
    ['file backup', initializeFileBackup],
    ['capsule reveal', initializeCapsuleReveal],
    ['stale pending recovery', initializeStalePendingRecovery],
    ['account purge dispatcher', initializeAccountPurgeDispatcher],
    ['storage reservation expiry', initializeStorageReservationExpiry],
    ['billing usage reconciliation', initializeBillingUsageReconciliation],
    ['store notification dispatcher', initializeStoreNotificationDispatcher],
    ['archive export dispatcher', initializeArchiveExportDispatcher],
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
export * from './explore-questions';
