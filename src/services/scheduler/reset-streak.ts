import dayjs from "dayjs";
import User from "../../module/database/model/user";

export default async function resetStreak() {
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