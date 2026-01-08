import dayjs from "dayjs";
import User from "../../module/database/model/user";
import { RedisConnection } from "../../services/redis";
import { Worker } from "bullmq";
import { compareStrings, queueNames } from "../../utils";

async function resetStreak() {
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  const result = await User.updateMany(
    {
      $or: [
        { last_task_date: { $lt: yesterday } },
        { last_task_date: null },
        { last_task_date: { $exists: false } },
      ],
    },
    {
      $set: { streak: 0 },
    },
  );

  return {
    message: 'Streaks reset for inactive users',
    data: {
      usersUpdated: result.modifiedCount,
      totalMatched: result.matchedCount,
    },
  };
}

export default function startSystemWorker(connection: RedisConnection) {
  return new Worker(
    queueNames.system.id,
    async (job) => {
      if (compareStrings(job.name, queueNames.system.jobs.resetStreak)) {
        await resetStreak();
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