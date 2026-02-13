import { RedisConnection } from "../../services/redis";
import { Worker } from "bullmq";
import { compareStrings, queueNames } from "../../utils";
import backupFiles from "./backup-files";
import resetStreak from "./reset-streak";

export default function startSystemWorker(connection: RedisConnection) {
  return new Worker(
    queueNames.system.id,
    async (job) => {
      if (compareStrings(job.name, queueNames.system.jobs.resetStreak)) {
        await resetStreak();
      }
      if (compareStrings(job.name, queueNames.system.jobs.backupFiles)) {
        await backupFiles();
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: {
        max: 5,
        duration: 60000
      }
    }
  );
}