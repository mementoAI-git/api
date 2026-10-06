import PromptShuffleUsage from '../../database/model/prompt-shuffle-usage';

export const DAILY_SHUFFLE_LIMIT = 2;

export function shuffleDay(userId: string, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const resetsAt = new Date(`${date}T00:00:00.000Z`);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return {
    key: `${userId}:${date}`,
    resetsAt,
    expiresAt: new Date(resetsAt.getTime() + 7 * 86400000),
  };
}

function state(used: number, resetsAt: Date) {
  return {
    used,
    remaining: Math.max(0, DAILY_SHUFFLE_LIMIT - used),
    limit: DAILY_SHUFFLE_LIMIT,
    resets_at: resetsAt.toISOString(),
  };
}

export async function getShuffleUsage(userId: string, now = new Date()) {
  const day = shuffleDay(userId, now);
  const usage = await PromptShuffleUsage.findById(day.key).lean();
  return state(usage?.used ?? 0, day.resetsAt);
}

export async function consumeShuffle(userId: string, now = new Date()) {
  const day = shuffleDay(userId, now);
  try {
    // The count condition and increment are atomic. The unique _id also guards
    // concurrent first requests; once exhausted, the upsert hits that same id.
    const usage = await PromptShuffleUsage.findOneAndUpdate(
      {_id: day.key, used: {$lt: DAILY_SHUFFLE_LIMIT}},
      {$inc: {used: 1}, $setOnInsert: {expires_at: day.expiresAt}},
      {upsert: true, new: true},
    ).lean();
    return {...state(usage.used, day.resetsAt), allowed: true};
  } catch (error) {
    if ((error as {code?: number})?.code !== 11000) throw error;
    const usage = await getShuffleUsage(userId, now);
    if (usage.remaining > 0) return consumeShuffle(userId, now);
    return {...usage, allowed: false};
  }
}
