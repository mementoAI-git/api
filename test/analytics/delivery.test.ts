import {describe, expect, it, vi} from 'vitest';
import {
  createGrowthAnalytics,
  GrowthOutboxStore,
  OutboxEvent,
  readGrowthAnalyticsConfig,
  resolveAnalyticsEnvironment,
} from '../../src/services/growth-analytics/core';

class MemoryStore implements GrowthOutboxStore {
  rows = new Map<string, OutboxEvent>();
  async insert(event: OutboxEvent) {
    if (!this.rows.has(event.key)) this.rows.set(event.key, {...event});
  }
  async claim(now: Date, owner: string, until: Date) {
    const row = [...this.rows.values()].find(
      row =>
        !row.deliveredAt &&
        row.nextAttemptAt <= now &&
        (!row.leaseUntil || row.leaseUntil <= now),
    );
    if (!row) return null;
    row.owner = owner;
    row.leaseUntil = until;
    row.attempts++;
    return {...row};
  }
  async delivered(key: string, owner: string, at: Date) {
    const row = this.rows.get(key)!;
    if (row.owner === owner) row.deliveredAt = at;
  }
  async retry(key: string, owner: string, at: Date) {
    const row = this.rows.get(key)!;
    if (row.owner === owner) {
      row.nextAttemptAt = at;
      row.leaseUntil = undefined;
    }
  }
}

const input = {
  event: 'growth_account_created' as const,
  distinctId: 'user-id',
  key: 'account:user-id',
  properties: {acquisition_source: 'direct'},
};

describe('growth analytics delivery', () => {
  it('queues once without network work and keeps delivered keys idempotent', async () => {
    const store = new MemoryStore();
    const batches: OutboxEvent[][] = [];
    const analytics = createGrowthAnalytics({
      store,
      publish: async rows => {
        batches.push(rows);
      },
    });
    await analytics.record(input);
    await analytics.record(input);
    expect(batches).toHaveLength(0);
    expect(store.rows.size).toBe(1);
    await analytics.flush();
    await analytics.record(input);
    await analytics.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0][0].uuid).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    expect(batches[0][0].properties).toMatchObject({
      analytics_source: 'api',
      analytics_schema_version: 1,
    });
  });

  it('retries failures after backoff with the original timestamp and UUID', async () => {
    const store = new MemoryStore();
    let time = new Date('2026-10-01T00:00:00Z');
    const batches: OutboxEvent[][] = [];
    const analytics = createGrowthAnalytics({
      store,
      now: () => time,
      publish: async rows => {
        batches.push(rows);
        if (batches.length === 1) throw new Error('offline');
      },
    });
    await analytics.record(input);
    await analytics.flush();
    await analytics.flush();
    expect(batches).toHaveLength(1);
    time = new Date(time.getTime() + 60_000);
    await analytics.flush();
    expect(batches).toHaveLength(2);
    expect(batches[1][0].uuid).toBe(batches[0][0].uuid);
    expect(batches[1][0].timestamp).toEqual(batches[0][0].timestamp);
  });

  it('does not double publish across concurrent publishers', async () => {
    const store = new MemoryStore();
    let published = 0;
    const options = {
      store,
      publish: async () => {
        published++;
      },
    };
    const first = createGrowthAnalytics(options);
    const second = createGrowthAnalytics(options);
    await first.record(input);
    await Promise.all([first.flush(), second.flush()]);
    expect(published).toBe(1);
  });

  it('drops unapproved content, nested values and caller-supplied metadata', async () => {
    const store = new MemoryStore();
    const analytics = createGrowthAnalytics({store, publish: async () => {}});
    await analytics.record({
      ...input,
      properties: {
        title: 'private title',
        email: 'private@example.com',
        user_agent: 'private',
        memory_id: {nested: 'private'},
        completed_exchanges: Number.NaN,
        analytics_source: 'web',
        analytics_schema_version: 50,
      } as never,
    });
    expect([...store.rows.values()][0].properties).toEqual({
      analytics_source: 'api',
      analytics_schema_version: 1,
      environment: 'test',
    });
  });

  it('never propagates persistence errors or invalid input into user actions', async () => {
    const store = new MemoryStore();
    store.insert = async () => {
      throw new Error('database unavailable');
    };
    const analytics = createGrowthAnalytics({
      store,
      publish: async () => {
        throw new Error('offline');
      },
    });
    await expect(analytics.record(input)).resolves.toBeUndefined();
    await expect(
      analytics.record({...input, timestamp: new Date('invalid')}),
    ).resolves.toBeUndefined();
  });

  it('bounds each flush even when a backlog exceeds batch capacity', async () => {
    const store = new MemoryStore();
    let published = 0;
    const analytics = createGrowthAnalytics({
      store,
      publish: async rows => {
        published += rows.length;
      },
    });
    for (let n = 0; n < 225; n++)
      await analytics.record({...input, key: `event:${n}`});
    await analytics.flush();
    expect(published).toBe(200);
  });

  it('separates staging from production even when both run production Node', () => {
    expect(
      resolveAnalyticsEnvironment({NODE_ENV: 'production', MEMENTO_ENV: 'dev'}),
    ).toBe('staging');
    expect(
      resolveAnalyticsEnvironment({
        NODE_ENV: 'production',
        MEMENTO_ENV: 'prod',
      }),
    ).toBe('production');
    expect(
      resolveAnalyticsEnvironment({
        NODE_ENV: 'production',
        POSTHOG_ENVIRONMENT: 'development',
        MEMENTO_ENV: 'dev',
      }),
    ).toBe('development');
  });

  it('bounds shutdown while a publisher is stuck and allows its completion later', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryStore();
      let release!: () => void;
      const waiting = new Promise<void>(resolve => {
        release = resolve;
      });
      const analytics = createGrowthAnalytics({
        store,
        publish: async () => waiting,
      });
      await analytics.record(input);
      const stopped = analytics.stop();
      await vi.advanceTimersByTimeAsync(4000);
      await expect(stopped).resolves.toBeUndefined();
      release();
      await analytics.flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables missing/unsafe configuration and the default test environment', () => {
    expect(readGrowthAnalyticsConfig({})).toBeNull();
    const env = {
      POSTHOG_PROJECT_TOKEN: 'public-token',
      POSTHOG_HOST: 'https://us.i.posthog.com',
      POSTHOG_IDENTITY_SECRET: 's'.repeat(32),
      NODE_ENV: 'production',
    };
    expect(
      readGrowthAnalyticsConfig({
        ...env,
        POSTHOG_IDENTITY_SECRET: 's'.repeat(31),
      }),
    ).toBeNull();
    expect(
      readGrowthAnalyticsConfig({
        ...env,
        POSTHOG_IDENTITY_SECRET: 's'.repeat(32),
      })?.identitySecret,
    ).toHaveLength(32);
    expect(readGrowthAnalyticsConfig(env)?.host).toBe(
      'https://us.i.posthog.com',
    );
    expect(readGrowthAnalyticsConfig({...env, NODE_ENV: 'test'})).toBeNull();
    expect(
      readGrowthAnalyticsConfig({...env, POSTHOG_HOST: 'http://unsafe.test'}),
    ).toBeNull();
    expect(
      readGrowthAnalyticsConfig({
        ...env,
        POSTHOG_HOST: 'https://user:password@host.test',
      }),
    ).toBeNull();
  });
});
