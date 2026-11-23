import VoiceUsage from '../../database/model/voice-usage';

/**
 * Free members can use voice mode for 90 minutes each calendar month,
 * across as many calls as they like, so they can try it before upgrading.
 * Every member's calls are recorded, so the apps can show monthly and
 * all-time voice minutes on any plan.
 *
 * A month is the member's own calendar month: it starts at midnight on the
 * 1st in the time zone their app sends (UTC when it sends none).
 */
export const FREE_VOICE_SECONDS_PER_MONTH = 90 * 60;

/** The longest one call can count for, so a stray ticket can never record days. */
const MAX_CALL_SECONDS = 6 * 60 * 60;

function zoneParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const value = (type: string) =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** The zone's offset from UTC at a moment, in milliseconds. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const p = zoneParts(at, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The month a moment counts towards, as YYYY-MM in the member's time zone. */
export function voiceUsageMonth(at: number | Date, timeZone = 'UTC'): string {
  const {year, month} = zoneParts(new Date(at).getTime(), timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** When the allowance next resets: midnight on the 1st of next month, in the member's zone. */
export function nextVoiceAllowanceReset(
  now = Date.now(),
  timeZone = 'UTC',
): Date {
  const {year, month} = zoneParts(now, timeZone);
  const localMidnight = Date.UTC(year, month, 1); // month is 1-based, so this is next month
  // Correct for the zone's offset at that moment (twice, in case it crosses a DST change).
  let instant = localMidnight - zoneOffsetMs(localMidnight, timeZone);
  instant = localMidnight - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

export type VoiceCallReport = {
  /** The server's clock now, in milliseconds. */
  now?: number;
  timeZone?: string;
  /**
   * Sent by apps while the call is connected. The first one starts the call's
   * clock, so time spent before the call connected (a token fetched ahead of
   * the tap) is never counted. Without it the clock runs from the ticket.
   */
  connected?: boolean;
  /**
   * Total seconds of long silences in the call so far, as the app measured
   * them: the part of each silence after its first minute. Not counted.
   */
  quietSeconds?: number;
  /** A length the app reported at the end of the call; the count never exceeds it. */
  reportedSeconds?: number;
};

/**
 * Records how long a call has been in use: from the moment it connected (or its
 * ticket, for apps that don't say), less its long silences, never more than it
 * has existed or than the app reported, and capped at six hours. Only ever raises
 * the recorded time, so a late or repeated report cannot shrink it. The call
 * counts towards the month it started in, in the member's time zone.
 */
export async function recordVoiceCallSeconds(
  userId: string,
  callStartedAt: number,
  {
    now = Date.now(),
    timeZone = 'UTC',
    connected = false,
    quietSeconds,
    reportedSeconds,
  }: VoiceCallReport = {},
): Promise<void> {
  const quiet = Math.max(
    0,
    Math.min(MAX_CALL_SECONDS, Math.round(quietSeconds ?? 0)),
  );
  const elapsed = {
    $divide: [
      {$subtract: [now, {$ifNull: ['$counted_from', callStartedAt]}]},
      1000,
    ],
  };
  const used = {
    $subtract: [
      reportedSeconds === undefined
        ? elapsed
        : {$min: [elapsed, Math.max(0, reportedSeconds)]},
      '$quiet_seconds',
    ],
  };
  const pipeline = [
    {
      $set: {
        month: {$ifNull: ['$month', voiceUsageMonth(callStartedAt, timeZone)]},
        created_at: {$ifNull: ['$created_at', '$$NOW']},
        updated_at: '$$NOW',
        quiet_seconds: {$max: [{$ifNull: ['$quiet_seconds', 0]}, quiet]},
        ...(connected && {counted_from: {$ifNull: ['$counted_from', now]}}),
      },
    },
    {
      $set: {
        seconds: {
          $max: [
            {$ifNull: ['$seconds', 0]},
            {
              $round: [{$min: [MAX_CALL_SECONDS, {$max: [0, used]}]}, 0],
            },
          ],
        },
      },
    },
  ];
  const filter = {user: userId, call_started_at: callStartedAt};
  await VoiceUsage.collection
    .updateOne(filter, pipeline, {upsert: true})
    .catch(async error => {
      // Two requests for a new call can race to create it; the loser retries as an update.
      if ((error as {code?: number})?.code !== 11000) throw error;
      await VoiceUsage.collection.updateOne(filter, pipeline);
    });
}

/** How far back an end report may land from the call's real start (a late send, a slow connect). */
const END_REPORT_EARLY_MS = 10 * 60_000;
const END_REPORT_LATE_MS = 60_000;

/**
 * Counts a finished call's reported length. The apps report the length when a
 * call ends or its recording is saved, but not which call ticket it had, so
 * the call is the one that started closest to (now - length). The length can
 * never exceed how long the call has been connected, and its long silences
 * stay uncounted. Apps that send usage check-ins have usually recorded the
 * call already; this only fills in what they missed.
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
  await recordVoiceCallSeconds(userId, call.call_started_at, {
    now,
    reportedSeconds: durationSeconds,
  });
}

/** Seconds of voice mode used in the member's current month. */
export async function voiceSecondsUsedThisMonth(
  userId: string,
  now = Date.now(),
  timeZone = 'UTC',
): Promise<number> {
  const [total] = await VoiceUsage.aggregate<{seconds: number}>([
    {$match: {user: userId, month: voiceUsageMonth(now, timeZone)}},
    {$group: {_id: null, seconds: {$sum: '$seconds'}}},
  ]);
  return total?.seconds ?? 0;
}

/** Seconds of voice mode used since the member's first call. */
export async function voiceSecondsUsedAllTime(userId: string): Promise<number> {
  const [total] = await VoiceUsage.aggregate<{seconds: number}>([
    {$match: {user: userId}},
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
  timeZone = 'UTC',
): Promise<FreeVoiceAllowance> {
  const used = Math.min(
    FREE_VOICE_SECONDS_PER_MONTH,
    await voiceSecondsUsedThisMonth(userId, now, timeZone),
  );
  return {
    voice_seconds_limit: FREE_VOICE_SECONDS_PER_MONTH,
    voice_seconds_used: used,
    voice_seconds_left: FREE_VOICE_SECONDS_PER_MONTH - used,
    voice_allowance_resets_at: nextVoiceAllowanceReset(
      now,
      timeZone,
    ).toISOString(),
  };
}

export type VoiceUsageSummary = {
  /** The member's current month, as YYYY-MM in their time zone. */
  month: string;
  month_seconds: number;
  all_time_seconds: number;
  /** When "this month" next starts over, as ISO 8601. */
  month_resets_at: string;
  /** Free plan only: the month's allowance and what is left of it. Null on paid plans. */
  free_seconds_limit: number | null;
  free_seconds_left: number | null;
};

/** Voice minutes for the Insights cards: this month, all time, and the free allowance. */
export async function getVoiceUsageSummary(
  userId: string,
  isFree: boolean,
  now = Date.now(),
  timeZone = 'UTC',
): Promise<VoiceUsageSummary> {
  const [monthSeconds, allTimeSeconds] = await Promise.all([
    voiceSecondsUsedThisMonth(userId, now, timeZone),
    voiceSecondsUsedAllTime(userId),
  ]);
  return {
    month: voiceUsageMonth(now, timeZone),
    month_seconds: monthSeconds,
    all_time_seconds: allTimeSeconds,
    month_resets_at: nextVoiceAllowanceReset(now, timeZone).toISOString(),
    free_seconds_limit: isFree ? FREE_VOICE_SECONDS_PER_MONTH : null,
    free_seconds_left: isFree
      ? Math.max(0, FREE_VOICE_SECONDS_PER_MONTH - monthSeconds)
      : null,
  };
}
