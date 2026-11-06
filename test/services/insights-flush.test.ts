import {beforeEach, describe, expect, it, vi} from 'vitest';

const {store, added} = vi.hoisted(() => ({
  store: new Map<string, string>(),
  added: [] as {
    name: string;
    data: Record<string, unknown>;
    opts: Record<string, unknown>;
  }[],
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = async (name: string, data: never, opts: never) => {
      added.push({name, data, opts});
    };
  },
}));
vi.mock('../../src/services/redis', () => ({
  getRedisConnection: () => ({}),
  default: {
    isOpen: true,
    get: async (key: string) => store.get(key) ?? null,
    setEx: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
    },
    del: async (key: string) => {
      store.delete(key);
    },
  },
}));

import {
  addToInsightsBuffer,
  FLUSH_BUFFER_JOB,
  flushBufferNow,
  flushQuietBuffer,
  INSIGHTS_QUIET_MS,
} from '../../src/services/queues/insights';

const extractions = () => added.filter(job => job.name === 'extract-insights');
const flushes = () => added.filter(job => job.name === FLUSH_BUFFER_JOB);
const key = 'insights:buffer:u1:m1';

function age(ms: number) {
  const buffer = JSON.parse(store.get(key)!);
  buffer.lastUpdated = Date.now() - ms;
  store.set(key, JSON.stringify(buffer));
}

describe('short conversations', () => {
  beforeEach(() => {
    store.clear();
    added.length = 0;
  });

  it('schedules a read when an exchange is buffered', async () => {
    await addToInsightsBuffer('u1', 'm1', 'hello there', 'hi');

    expect(extractions()).toEqual([]);
    expect(flushes()[0]).toMatchObject({
      data: {user_id: 'u1', memory_id: 'm1'},
      opts: {delay: INSIGHTS_QUIET_MS, removeOnComplete: true},
    });
  });

  it('reads one exchange once the conversation goes quiet', async () => {
    await addToInsightsBuffer('u1', 'm1', 'hello there', 'hi');
    age(INSIGHTS_QUIET_MS);

    await flushQuietBuffer('u1', 'm1');

    expect(extractions()[0].data).toMatchObject({
      memory_id: 'm1',
      exchanges: [{user: 'hello there', ai: 'hi'}],
    });
    expect(store.has(key)).toBe(false);
  });

  it('waits out the remainder while the conversation is still active', async () => {
    await addToInsightsBuffer('u1', 'm1', 'hello there', 'hi');
    added.length = 0;
    age(INSIGHTS_QUIET_MS - 60_000);

    await flushQuietBuffer('u1', 'm1');

    expect(extractions()).toEqual([]);
    expect(flushes()[0].opts.delay).toBeLessThanOrEqual(60_000);
    expect(flushes()[0].opts.delay).toBeGreaterThan(50_000);
    expect(store.has(key)).toBe(true);
  });

  it('does nothing once the buffer is already read', async () => {
    await flushQuietBuffer('u1', 'm1');
    await flushBufferNow('u1', 'm1');

    expect(added).toEqual([]);
  });

  it('still reads a full batch straight away, once', async () => {
    for (let i = 0; i < 5; i += 1) {
      await addToInsightsBuffer('u1', 'm1', `message ${i}`, 'reply');
    }

    expect(extractions()).toHaveLength(1);
    expect(extractions()[0].data.exchanges).toHaveLength(5);
    await flushQuietBuffer('u1', 'm1');
    expect(extractions()).toHaveLength(1);
  });

  it('reads right away when a call ends', async () => {
    await addToInsightsBuffer('u1', 'm1', 'hello there', 'hi');

    await flushBufferNow('u1', 'm1');

    expect(extractions()).toHaveLength(1);
  });
});
