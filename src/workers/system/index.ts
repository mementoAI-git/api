import { RedisConnection } from "../../services/redis";
import { Worker } from "bullmq";
import { compareStrings, queueNames } from "../../utils";
import backupFiles from "./backup-files";
import { revealCapsules, scheduleCapsuleReveals } from "./reveal-capsules";
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
      if (compareStrings(job.name, queueNames.system.jobs.scheduleCapsuleReveals)) {
        await scheduleCapsuleReveals();
      }
      if (compareStrings(job.name, queueNames.system.jobs.revealCapsules)) {
        await revealCapsules(job as { data: { capsuleId: string } });
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