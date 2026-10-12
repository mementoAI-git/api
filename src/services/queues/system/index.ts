import {Queue} from 'bullmq';
import {logger, queueNames} from '../../../utils';
import {getRedisConnection} from '../../redis';
import {IS_PRODUCTION, MEMORY_RETRIEVAL} from '../../../utils/config';
import dayjs from 'dayjs';
import PurgeCommand from '../../../module/database/model/purge-command';
import {PURGE_SCHEMA_VERSION} from '../../account-purge';
import StoreNotificationEvent from '../../../module/database/model/store-notification-event';
import ArchiveExport from '../../../module/database/model/archive-export';

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
  if (!systemQueue) {
    logger.error(
      'System queue not available, cannot initialize capsule reveal scheduler',
    );
    return;
  }

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

/** Durable purge commands are polled because Redis publication is not the outbox. */
export async function initializeAccountPurgeDispatcher(): Promise<void> {
  if (!systemQueue) {
    logger.error(
      'System queue not available, account purge commands remain pending',
    );
    return;
  }

  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.dispatchAccountPurges,
    {every: 60 * 1000},
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
}

/** Keeps memory embeddings in step with new and edited stories and messages. */
export async function initializeMemoryEmbeddings(): Promise<void> {
  if (!systemQueue) {
    logger.error(
      'System queue not available, memory embeddings will not update',
    );
    return;
  }
  if (MEMORY_RETRIEVAL !== 'inhouse') return;
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.sweepMemoryEmbeddings,
    {every: 5 * 60 * 1000},
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.pruneMemoryEmbeddings,
    {pattern: '30 3 * * *'}, // daily, 03:30 UTC
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
}

export async function initializeStorageReservationExpiry(): Promise<void> {
  if (!systemQueue) {
    logger.error(
      'System queue not available, storage reservations cannot be expired',
    );
    return;
  }
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.expireStorageReservations,
    {every: 5 * 60 * 1000},
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
}

export async function initializeBillingUsageReconciliation(): Promise<void> {
  if (!systemQueue) {
    logger.error(
      'System queue not available, billing usage cannot be reconciled',
    );
    return;
  }
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.reconcileBillingUsage,
    {pattern: '30 2 * * *'},
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
}

export async function initializeStoreNotificationDispatcher(): Promise<void> {
  if (!systemQueue) {
    logger.error(
      'System queue not available, store notifications remain pending',
    );
    return;
  }
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.dispatchStoreNotifications,
    {every: 5 * 60 * 1000},
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
}

export async function dispatchPendingStoreNotifications(): Promise<number> {
  if (!systemQueue) return 0;
  const events = await StoreNotificationEvent.find({
    status: {$in: ['pending', 'failed', 'unmapped']},
  })
    .sort({received_at: 1})
    .limit(100)
    .select('_id')
    .lean();
  for (const event of events) {
    await systemQueue.add(
      queueNames.system.jobs.processStoreNotification,
      {eventId: String(event._id)},
      {
        jobId: `store-notification-${event._id}`,
        attempts: 10,
        backoff: {type: 'exponential', delay: 5000},
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
  return events.length;
}

export async function queueArchiveExport(exportId: string): Promise<boolean> {
  if (!systemQueue) return false;
  await systemQueue.add(
    queueNames.system.jobs.archiveExport,
    {exportId},
    {
      jobId: `archive-export-${exportId}`,
      attempts: 3,
      backoff: {type: 'exponential', delay: 5000},
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  return true;
}

export async function initializeArchiveExportDispatcher(): Promise<void> {
  if (!systemQueue) return;
  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.dispatchArchiveExports,
    {every: 5 * 60 * 1000},
    {opts: {removeOnComplete: true, removeOnFail: 10}},
  );
}

export async function dispatchPendingArchiveExports(): Promise<number> {
  const jobs = await ArchiveExport.find({status: 'pending'})
    .sort({created_at: 1})
    .limit(20)
    .select('_id')
    .lean();
  for (const job of jobs) await queueArchiveExport(String(job._id));
  return jobs.length;
}

export async function dispatchPendingAccountPurges(): Promise<number> {
  if (!systemQueue) return 0;
  const commands = await PurgeCommand.find({
    available_at: {$lte: new Date()},
    $or: [
      {status: {$in: ['pending', 'failed']}},
      {
        status: 'running',
        started_at: {$lte: new Date(Date.now() - 15 * 60 * 1000)},
      },
    ],
  })
    .sort({created_at: 1})
    .limit(50)
    .lean();

  for (const command of commands) {
    await systemQueue.add(
      queueNames.system.jobs.accountPurge,
      {schema_version: command.schema_version, command_id: String(command._id)},
      {
        jobId: `account-purge-${command._id}`,
        attempts: 10,
        backoff: {type: 'exponential', delay: 5000},
        removeOnComplete: 100,
        removeOnFail: true,
      },
    );
  }
  return commands.length;
}

export async function publishAccountPurge(commandId: string): Promise<boolean> {
  if (!systemQueue) return false;
  await systemQueue.add(
    queueNames.system.jobs.accountPurge,
    {schema_version: PURGE_SCHEMA_VERSION, command_id: commandId},
    {
      jobId: `account-purge-${commandId}`,
      attempts: 10,
      backoff: {type: 'exponential', delay: 5000},
      removeOnComplete: 100,
      removeOnFail: true,
    },
  );
  return true;
}

export async function scheduleCapsuleDelivery(
  capsule_id: string,
  schedule_date: string,
): Promise<void> {
  const now = dayjs();
  const scheduleDate = dayjs(schedule_date);
  const delayMs = Math.max(0, scheduleDate.valueOf() - now.valueOf());

  if (!systemQueue) {
    logger.warn({capsule_id}, 'System queue unavailable for capsule delivery');
    return;
  }
  const jobId = `capsule-reveal-${capsule_id}`;
  const existing = await systemQueue.getJob(jobId);
  if (existing && ['delayed', 'waiting'].includes(await existing.getState())) {
    await existing.remove();
  }
  await systemQueue.add(
    queueNames.system.jobs.revealCapsules,
    {schema_version: 1, capsuleId: capsule_id},
    {
      jobId,
      delay: delayMs,
      attempts: 5,
      backoff: {type: 'exponential', delay: 5000},
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function queueAttachmentThumbnailProcessing(
  fileId: string,
): Promise<boolean> {
  if (!systemQueue) {
    logger.warn(
      {fileId},
      'System queue not available, cannot queue attachment thumbnail processing',
    );
    return false;
  }

  await systemQueue.add(
    queueNames.system.jobs.processAttachmentThumbnail,
    {fileId},
    {
      attempts: 3,
      backoff: {type: 'exponential', delay: 2000},
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  );

  return true;
}
