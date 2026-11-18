import VoiceUsage from '../../database/model/voice-usage';

/**
 * Free members can use voice mode for 90 minutes each calendar month (UTC),
 * across as many calls as they like, so they can try it before upgrading.
 */
export const FREE_VOICE_SECONDS_PER_MONTH = 90 * 60;

/** The month a moment counts towards, as YYYY-MM in UTC. */
export function voiceUsageMonth(at: number | Date): string {
  return new Date(at).toISOString().slice(0, 7);
}

/** When the allowance next resets: the start of the following UTC month. */
export function nextVoiceAllowanceReset(now = Date.now()): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/**
 * Records how long a call has run. Only ever raises the recorded time, so a
 * late or repeated report cannot shrink it. The call counts towards the month
 * it started in.
 */
export async function recordVoiceCallSeconds(
  userId: string,
  callStartedAt: number,
  seconds: number,
): Promise<void> {
  const value = Math.max(0, Math.round(seconds));
  await VoiceUsage.updateOne(
    {user: userId, call_started_at: callStartedAt},
    {
      $max: {seconds: value},
      $setOnInsert: {month: voiceUsageMonth(callStartedAt)},
    },
    {upsert: true},
  ).catch(async error => {
    // Two requests for a new call can race to create it; the loser retries as an update.
    if ((error as {code?: number})?.code !== 11000) throw error;
    await VoiceUsage.updateOne(
      {user: userId, call_started_at: callStartedAt},
      {$max: {seconds: value}},
    );
  });
}

/** How far back an end report may land from the call's real start (a late send, a slow connect). */
const END_REPORT_EARLY_MS = 10 * 60_000;
const END_REPORT_LATE_MS = 60_000;

/**
 * Counts a finished call's reported length towards the monthly minutes. The
 * apps report the length when a call ends or its recording is saved, but not
 * which call ticket it had, so the call is the one that started closest to
 * (now - length). Only free members' calls have records to match; the length
 * can never exceed how long ago that call started.
 */
export async function recordEndedVoiceCall(
  userId: string,
  durationSeconds: number,
  now = Date.now(),
): Promise<void> {
  if (!(durationSeconds > 0)) return;
  const expectedStart = now - durationSeconds * 1000;
  const candidates = await VoiceUsage.find({
    user: userId,
    call_started_at: {
      $gte: expectedStart - END_REPORT_EARLY_MS,
      $lte: expectedStart + END_REPORT_LATE_MS,
    },
  })
    .select('call_started_at')
    .lean();
  if (!candidates.length) return;
  const call = candidates.reduce((best, next) =>
    Math.abs(next.call_started_at - expectedStart) <
    Math.abs(best.call_started_at - expectedStart)
      ? next
      : best,
  );
  await recordVoiceCallSeconds(
    userId,
    call.call_started_at,
    Math.min(durationSeconds, (now - call.call_started_at) / 1000),
  );
}

/** Seconds of voice mode used in the current month. */
export async function voiceSecondsUsedThisMonth(
  userId: string,
  now = Date.now(),
): Promise<number> {
  const [total] = await VoiceUsage.aggregate<{seconds: number}>([
    {$match: {user: userId, month: voiceUsageMonth(now)}},
    {$group: {_id: null, seconds: {$sum: '$seconds'}}},
  ]);
  return total?.seconds ?? 0;
}

export type FreeVoiceAllowance = {
  voice_seconds_limit: number;
  voice_seconds_used: number;
  voice_seconds_left: number;
  voice_allowance_resets_at: string;
};

export async function getFreeVoiceAllowance(
  userId: string,
  now = Date.now(),
): Promise<FreeVoiceAllowance> {
  const used = Math.min(
    FREE_VOICE_SECONDS_PER_MONTH,
    await voiceSecondsUsedThisMonth(userId, now),
  );
  return {
    voice_seconds_limit: FREE_VOICE_SECONDS_PER_MONTH,
    voice_seconds_used: used,
    voice_seconds_left: FREE_VOICE_SECONDS_PER_MONTH - used,
    voice_allowance_resets_at: nextVoiceAllowanceReset(now).toISOString(),
  };
}
