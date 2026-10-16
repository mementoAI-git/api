import {Application} from 'express';
import {
  initializeConversationSummary,
  initializePersonaSummarization,
} from './summarization';
import {
  initializeCapsuleReveal,
  initializeAccountPurgeDispatcher,
  initializeFileBackup,
  initializeResetStreak,
  initializeStalePendingRecovery,
  initializeStorageReservationExpiry,
  initializeMemoryEmbeddings,
  initializeBillingUsageReconciliation,
  initializeStoreNotificationDispatcher,
  initializeArchiveExportDispatcher,
} from './system';
import logger from '../../utils/logger';
import {BULL_BOARD_ENABLED} from '../../utils/config';

export function setupBullBoard(_app: Application): boolean {
  // Queue payloads contain private conversations. Staff access is limited to
  // aggregate /staff/metrics until a deliberately redacted queue UI exists.
  if (BULL_BOARD_ENABLED) {
    logger.warn('Raw queue dashboard is disabled to protect customer content');
  }
  return false;
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
    ['memory embeddings', initializeMemoryEmbeddings],
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
