/**
 * The host's own date and time, so "tomorrow", "next Friday" or "this
 * evening" mean what they mean to the host. The app sends the device time
 * zone with the token request; without it Memento says the zone is unknown
 * instead of silently using UTC.
 */

const MAX_ZONE = 64;

/** The zone when it is a real IANA time zone, otherwise undefined. */
export function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const zone = value.trim();
  if (!zone || zone.length > MAX_ZONE) return undefined;
  try {
    new Intl.DateTimeFormat('en-GB', {timeZone: zone});
    return zone;
  } catch {
    return undefined;
  }
}

function format(now: Date, timeZone: string): {date: string; time: string} {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
    .format(now)
    .replace(',', '');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return {date, time};
}

export function describeHostNow(
  timeZone: string | undefined,
  now: Date = new Date(),
): string {
  if (timeZone) {
    const {date, time} = format(now, timeZone);
    return [
      `TODAY: for the host it is ${date}, ${time} (${timeZone}).`,
      'Use this for "today", "tomorrow", "next Friday" and similar. Give dates to tools as YYYY-MM-DD in the host\'s time zone.',
      'When a relative date could mean two days ("next Friday" this week or next), say the exact date you mean ("Friday the 16th") so the host can correct you.',
    ].join('\n');
  }
  const {date, time} = format(now, 'UTC');
  return [
    `TODAY: it is ${date}, ${time} UTC. The host's time zone is unknown.`,
    'If a date or time depends on their time zone ("tonight", "tomorrow morning"), check with them. Give dates to tools as YYYY-MM-DD.',
  ].join('\n');
}
