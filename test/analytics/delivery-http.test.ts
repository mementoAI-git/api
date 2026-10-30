import {describe, expect, it} from 'vitest';
import {createPostHogPublisher} from '../../src/services/growth-analytics/http';
import {
  flushGrowthAnalytics,
  isGrowthAnalyticsEnabled,
  recordGrowthEvent,
  startGrowthAnalytics,
} from '../../src/services/growth-analytics';

describe('PostHog HTTP delivery', () => {
  it('posts bounded content-free batch with stable UUID and no client context', async () => {
    let payload = '';
    let request: RequestInit | undefined;
    let url = '';
    const publish = createPostHogPublisher(
      {token: 'public-project-token', host: 'https://us.i.posthog.com'},
      async (input, init) => {
        url = String(input);
        request = init;
        payload = String(init?.body);
        return new Response('{}', {status: 200});
      },
    );
    await publish([
      {
        key: 'internal-key',
        uuid: 'stable-event-uuid',
        event: 'growth_account_created',
        distinctId: 'user-id',
        timestamp: new Date('2026-10-01Z'),
        properties: {analytics_source: 'api'},
        attempts: 1,
        nextAttemptAt: new Date(),
      },
    ]);
    expect(url).toBe('https://us.i.posthog.com/batch/');
    expect(JSON.parse(payload)).toEqual({
      token: 'public-project-token',
      batch: [
        {
          uuid: 'stable-event-uuid',
          event: 'growth_account_created',
          timestamp: '2026-10-01T00:00:00.000Z',
          properties: {
            analytics_source: 'api',
            distinct_id: 'user-id',
            $geoip_disable: true,
            $process_person_profile: false,
          },
        },
      ],
    });
    expect(request?.headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'memento-growth-analytics/1',
    });
    expect(request?.signal).toBeDefined();
    expect(payload).not.toContain('internal-key');
  });

  it('rejects failed HTTP delivery so the outbox retries', async () => {
    const publish = createPostHogPublisher(
      {token: 'token', host: 'https://us.i.posthog.com'},
      async () => new Response('', {status: 503}),
    );
    await expect(publish([])).rejects.toThrow(
      'Growth analytics delivery failed',
    );
  });

  it('keeps default singleton disabled in tests and stop is safe', async () => {
    expect(isGrowthAnalyticsEnabled()).toBe(false);
    await recordGrowthEvent({
      event: 'growth_account_created',
      key: 'x',
      distinctId: 'x',
      properties: {},
    });
    await flushGrowthAnalytics();
    await startGrowthAnalytics()();
  });
});
