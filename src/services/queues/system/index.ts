import { Queue } from "bullmq";
import { logger, queueNames } from "../../../utils";
import { getRedisConnection } from "../../redis";

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