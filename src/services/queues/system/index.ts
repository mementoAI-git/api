import { Queue } from "bullmq";
import { logger, queueNames } from "../../../utils";
import { getRedisConnection } from "../../redis";
import { IS_PRODUCTION, NODE_ENV } from "../../../utils/config";

const connection = getRedisConnection();

// System queue
export const systemQueue = connection
  ? new Queue(queueNames.system.id, { connection })
  : null;

export async function initializeResetStreak(): Promise<void> {
  if (!systemQueue) {
    logger.error('System queue not available, cannot initialize recurring job');
    return;
  }

  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.resetStreak,
    { pattern: "0 0 * * *" }, // Cron pattern: every day at midnight UTC
    {
      opts: {
        removeOnComplete: true,
        removeOnFail: 3
      }
    }
  )

  logger.debug('Initialized reset streak recurring job (runs daily at midnight UTC)');
}

/** Weekly backup (Sunday 00:00 UTC). */
export async function initializeFileBackup(): Promise<void> {
  // if (!IS_PRODUCTION) {
  //   return;
  // }

  if (!systemQueue) {
    logger.error('System queue not available, cannot initialize GCS→Cloudinary backup');
    return;
  }

  await systemQueue.upsertJobScheduler(
    queueNames.system.jobs.backupFiles,
    // { pattern: "0 0 * * 0" },
    { pattern: "* * * * *" },
    {
      opts: {
        removeOnComplete: true,
        removeOnFail: 3,
      },
    }
  );

  logger.debug('Initialized GCS→Cloudinary backup recurring job (runs weekly Sunday 00:00 UTC)');
}