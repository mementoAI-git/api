import {describe, expect, it, vi} from 'vitest';
import {
  growthAnalyticsProblems,
  growthAnalyticsWarnings,
  readGrowthAnalyticsConfig,
} from '../../src/services/growth-analytics/core';
import {reportGrowthAnalyticsStatus} from '../../src/services/growth-analytics';
import {growthConfigReport} from '../../src/scripts/growth-analytics/check-config';
import {
  countByDay,
  parseSince,
  registrationMethod,
} from '../../src/scripts/growth-analytics/backfill-signups';

const valid = {
  NODE_ENV: 'production',
  POSTHOG_PROJECT_TOKEN: 'phc_token',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  POSTHOG_IDENTITY_SECRET: 'x'.repeat(64),
};

describe('growth analytics settings', () => {
  it('is on with valid settings', () => {
    expect(growthAnalyticsProblems(valid)).toEqual([]);
    expect(readGrowthAnalyticsConfig(valid)).toMatchObject({
      host: 'https://us.i.posthog.com',
    });
  });

  it.each([
    [{POSTHOG_PROJECT_TOKEN: ''}, 'POSTHOG_PROJECT_TOKEN is not set'],
    [{POSTHOG_IDENTITY_SECRET: ''}, 'POSTHOG_IDENTITY_SECRET is not set'],
    [
      {POSTHOG_IDENTITY_SECRET: 'short'},
      'POSTHOG_IDENTITY_SECRET is shorter than 32 characters',
    ],
    [{POSTHOG_HOST: ''}, 'POSTHOG_HOST is not set'],
    [
      {POSTHOG_HOST: 'https://us.i.posthog.com/ingest'},
      'POSTHOG_HOST must be a bare https origin',
    ],
    [
      {POSTHOG_HOST: 'http://us.i.posthog.com'},
      'POSTHOG_HOST must be a bare https origin',
    ],
    [{POSTHOG_HOST: 'not a url'}, 'POSTHOG_HOST is not a valid URL'],
  ])('names the bad setting and switches off: %o', (override, problem) => {
    const env = {...valid, ...override};
    expect(growthAnalyticsProblems(env).join()).toContain(problem);
    expect(readGrowthAnalyticsConfig(env)).toBeNull();
  });

  it('warns when production events would be tagged as another environment', () => {
    expect(growthAnalyticsWarnings({...valid, MEMENTO_ENV: 'prod'})).toEqual(
      [],
    );
    expect(
      growthAnalyticsWarnings({
        ...valid,
        MEMENTO_ENV: 'prod',
        POSTHOG_ENVIRONMENT: 'production',
      }),
    ).toEqual([]);
    expect(
      growthAnalyticsWarnings({
        ...valid,
        MEMENTO_ENV: 'prod',
        POSTHOG_ENVIRONMENT: 'development',
      })[0],
    ).toContain('"development"');
    expect(growthAnalyticsWarnings({...valid, MEMENTO_ENV: 'dev'})).toEqual([]);
  });

  it('logs whether it is on at startup, never printing values', () => {
    const log = {info: vi.fn(), warn: vi.fn()};
    reportGrowthAnalyticsStatus(log as never, {...valid, MEMENTO_ENV: 'prod'});
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Growth analytics is on'),
    );

    const off = {info: vi.fn(), warn: vi.fn()};
    reportGrowthAnalyticsStatus(off as never, {
      ...valid,
      POSTHOG_IDENTITY_SECRET: 'tiny-secret',
    });
    expect(off.warn).toHaveBeenCalledWith(
      expect.stringContaining('POSTHOG_IDENTITY_SECRET is shorter'),
    );
    expect(JSON.stringify(off.warn.mock.calls)).not.toContain('tiny-secret');
  });

  it('prints GitHub warnings from the deploy check', () => {
    expect(growthConfigReport({...valid, POSTHOG_HOST: ''}, true)).toEqual([
      '::warning::Growth analytics is off, signups are not tracked: POSTHOG_HOST is not set',
    ]);
    expect(growthConfigReport({...valid, MEMENTO_ENV: 'prod'})).toEqual([
      'Growth analytics is on (environment "production")',
    ]);
  });
});

describe('signup backfill helpers', () => {
  it('reads --since as a UTC day and rejects other shapes', () => {
    expect(parseSince(['--since=2026-11-13'])?.toISOString()).toBe(
      '2026-11-13T00:00:00.000Z',
    );
    expect(parseSince([])).toBeUndefined();
    expect(() => parseSince(['--since=13/11/2026'])).toThrow();
  });

  it('tells email signups from OAuth ones', () => {
    expect(registrationMethod([])).toBe('email');
    expect(registrationMethod(undefined)).toBe('email');
    expect(registrationMethod(['google'])).toBe('oauth');
  });

  it('counts signups per UTC day', () => {
    expect(
      countByDay([
        new Date('2026-11-14T10:00:00Z'),
        new Date('2026-11-13T23:59:00Z'),
        new Date('2026-11-14T00:01:00Z'),
      ]),
    ).toEqual([
      ['2026-11-13', 1],
      ['2026-11-14', 2],
    ]);
  });
});
