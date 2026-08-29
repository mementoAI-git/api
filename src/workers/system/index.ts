import {RedisConnection} from '../../services/redis';
import {Worker} from 'bullmq';
import dayjs from 'dayjs';
import {compareStrings, logger, queueNames} from '../../utils';
import Memory from '../../module/database/model/memory';
import backupFiles from './backup-files';
import processAttachmentThumbnail from './process-attachment-thumbnail';
import {revealCapsules, scheduleCapsuleReveals} from './reveal-capsules';
import resetStreak from './reset-streak';
import {quickCaptureQueue} from '../../services/queues/quick-capture';
import {processPurgeCommand} from '../../services/account-purge';
import {dispatchPendingAccountPurges} from '../../services/queues/system';

/** Sweep for memories stuck at enrichment_status:'pending' for > 15 minutes.
 *  - If the quick-capture queue is available: re-enqueue for proper AI enrichment.
 *  - If Redis is still down: mark them 'complete' so users stop seeing the "pending" banner.
 */
async function recoverStalePendingCaptures(): Promise<void> {
  const cutoff = dayjs().subtract(15, 'minute').toDate();
  const stale = await Memory.find({
    enrichment_status: 'pending',
    created_at: {$lt: cutoff},
  })
    .select('_id user capture_source')
    .lean();

  if (stale.length === 0) return;

  logger.info(
    {count: stale.length},
    'Recovering stale-pending enrichment entries',
  );

  if (quickCaptureQueue) {
    // Queue is available — re-enqueue for proper AI enrichment
    await Promise.all(
      stale.map(m =>
        quickCaptureQueue.add(
          'enrich-quick-capture',
          {
            user_id: String(m.user),
            memory_id: String(m._id),
            transcript_uncertain: false,
          },
          {
            attempts: 3,
            backoff: {type: 'exponential', delay: 2000},
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        ),
      ),
    );
    logger.info(
      {count: stale.length},
      'Re-queued stale-pending memories for enrichment',
    );
  } else {
    // Queue still unavailable — mark complete so users are unblocked
    const ids = stale.map(m => m._id);
    await Memory.updateMany(
      {_id: {$in: ids}},
      {$set: {enrichment_status: 'complete'}},
    );
    logger.warn(
      {count: stale.length},
      'Queue unavailable: marked stale-pending memories as complete (no Redis)',
    );
  }
}

export default function startSystemWorker(connection: RedisConnection) {
  return new Worker(
    queueNames.system.id,
    async job => {
      if (compareStrings(job.name, queueNames.system.jobs.resetStreak)) {
        await resetStreak();
      }
      if (compareStrings(job.name, queueNames.system.jobs.backupFiles)) {
        await backupFiles();
      }
      if (
        compareStrings(
          job.name,
          queueNames.system.jobs.processAttachmentThumbnail,
        )
      ) {
        await processAttachmentThumbnail(job as {data: {fileId: string}});
      }
      if (
        compareStrings(job.name, queueNames.system.jobs.scheduleCapsuleReveals)
      ) {
        await scheduleCapsuleReveals();
      }
      if (compareStrings(job.name, queueNames.system.jobs.revealCapsules)) {
        await revealCapsules(job as {data: {capsuleId: string}});
      }
      if (
        compareStrings(job.name, queueNames.system.jobs.recoverStalePending)
      ) {
        await recoverStalePendingCaptures();
      }
      if (
        compareStrings(job.name, queueNames.system.jobs.dispatchAccountPurges)
      ) {
        await dispatchPendingAccountPurges();
      }
      if (compareStrings(job.name, queueNames.system.jobs.accountPurge)) {
        const data = job.data as {schema_version?: number; command_id?: string};
        if (data.schema_version !== 1 || !data.command_id) {
          throw new Error('Unsupported account purge job payload');
        }
        await processPurgeCommand(data.command_id);
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: {
        max: 5,
        duration: 60000,
      },
    },
  );
}
