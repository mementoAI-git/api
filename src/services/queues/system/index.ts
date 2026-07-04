import {Queue} from 'bullmq';
import {logger, queueNames} from '../../../utils';
import {getRedisConnection} from '../../redis';
import {IS_PRODUCTION} from '../../../utils/config';
import dayjs from 'dayjs';

const connection = getRedisConnection();

// System queue
export const systemQueue = connection
  ? new Queue(queueNames.system.id, {connection})
  : null;

export async function initializeResetStreak(): Promise<void> {
  if (!systemQueue) {
    logger.error('System queue not available, cannot initialize recurring job');
    return;
  }

  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.resetStreak,
    {pattern: '0 0 * * *'}, // Cron pattern: every day at midnight UTC
    {
      opts: {
        removeOnComplete: true,
        removeOnFail: 3,
      },
    },
  );

  logger.debug(
    'Initialized reset streak recurring job (runs daily at midnight UTC)',
  );
}

/** Weekly backup (Sunday 00:00 UTC). */
export async function initializeFileBackup(): Promise<void> {
  if (!IS_PRODUCTION) {
    return;
  }

  if (!systemQueue) {
    logger.error(
      'System queue not available, cannot initialize GCS→Cloudinary backup',
    );
    return;
  }

  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.backupFiles,
    {pattern: '0 0 * * 0'},
    {
      opts: {
        removeOnComplete: true,
        removeOnFail: 3,
      },
    },
  );

  logger.debug(
    'Initialized GCS→Cloudinary backup recurring job (runs weekly Sunday 00:00 UTC)',
  );
}

/** Daily at 00:00: finds today's scheduled capsules and enqueues reveal jobs with delay. */
export async function initializeCapsuleReveal(): Promise<void> {
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.scheduleCapsuleReveals,
    {pattern: '0 0 * * *'},
    {
      opts: {
        removeOnComplete: true,
        removeOnFail: 3,
      },
    },
  );

  logger.debug(
    'Initialized capsule reveal scheduler (runs daily at midnight UTC)',
  );
}

/** Every 30 min: re-queue or clear memories stuck at enrichment_status: 'pending' > 15 min. */
export async function initializeStalePendingRecovery(): Promise<void> {
  if (!systemQueue) {
    logger.error(
      'System queue not available, cannot initialize stale-pending recovery job',
    );
    return;
  }

  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.recoverStalePending,
    {every: 30 * 60 * 1000}, // every 30 minutes
    {
      opts: {
        removeOnComplete: true,
        removeOnFail: 3,
      },
    },
  );

  logger.debug(
    'Initialized stale-pending recovery job (runs every 30 minutes)',
  );
}

export async function scheduleCapsuleDelivery(
  capsule_id: string,
  schedule_date: string,
): Promise<void> {
  const now = dayjs();
  const scheduleDate = dayjs(schedule_date);
  const delayMs = Math.max(0, scheduleDate.valueOf() - now.valueOf());

  await systemQueue.add(
    queueNames.system.jobs.revealCapsules,
    {capsuleId: capsule_id},
    {delay: delayMs, removeOnComplete: true, removeOnFail: 3},
  );
}
