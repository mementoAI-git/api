import {describe, expect, it} from 'vitest';

import {
  describeHostNow,
  validTimeZone,
} from '../../src/module/api/ai/voice/local-time';

// Monday 12 October 2026, 14:04 UTC.
const NOW = new Date('2026-10-12T14:04:00Z');

describe('host local time', () => {
  it('accepts real IANA time zones only', () => {
    expect(validTimeZone('Africa/Lagos')).toBe('Africa/Lagos');
    expect(validTimeZone('America/New_York')).toBe('America/New_York');
    expect(validTimeZone('Mars/Olympus')).toBeUndefined();
    expect(validTimeZone('')).toBeUndefined();
    expect(validTimeZone(42)).toBeUndefined();
    expect(validTimeZone('x'.repeat(200))).toBeUndefined();
  });

  it("states the host's local date, weekday and time", () => {
    const text = describeHostNow('Africa/Lagos', NOW);
    expect(text).toContain('Monday 12 October 2026');
    expect(text).toContain('15:04');
    expect(text).toContain('Africa/Lagos');
    expect(text).toContain('YYYY-MM-DD');
  });

  it('gets the date right where it is already tomorrow', () => {
    expect(describeHostNow('Pacific/Auckland', NOW)).toContain(
      'Tuesday 13 October 2026',
    );
  });

  it('says the time zone is unknown rather than guessing', () => {
    const text = describeHostNow(undefined, NOW);
    expect(text).toContain('Monday 12 October 2026');
    expect(text).toMatch(/time zone is unknown/);
  });
});
