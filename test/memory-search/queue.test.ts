import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Queue} from 'bullmq';

const state = vi.hoisted(() => ({port: 6379}));
vi.mock('../../src/services/redis', () => ({
  getRedisConnection: () => ({host: '127.0.0.1', port: state.port}),
}));
vi.mock('bullmq', async importOriginal => {
  const real = await importOriginal<typeof import('bullmq')>();
  return {
    ...real,
    Queue: class extends real.Queue {
      constructor(
        name: string,
        options: ConstructorParameters<typeof real.Queue>[1],
      ) {
        super(name, {...options, prefix: `search-startup-test-${process.pid}`});
      }
    },
  };
});

let queue: Queue | null = null;
afterEach(async () => {
  if (queue) {
    if (state.port === 6379)
      await queue.obliterate({force: true}).catch(() => {});
    await queue.close();
    queue = null;
  }
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function setup(port = 6379) {
  state.port = port;
  vi.stubEnv('MEMORY_SEARCH_ENABLED', 'true');
  vi.stubEnv('MEMORY_SEARCH_USER_IDS', 'pilot-startup-test');
  vi.stubEnv('MEMORY_SEARCH_DIGUP_PATH', '/test/digup');
  vi.stubEnv('MEMORY_SEARCH_MODELS_DIR', '/test/models');
  const mod = await import('../../src/services/queues/memory-search');
  queue = mod.memorySearchQueue;
  return mod;
}

describe.skipIf(process.env.RUN_REDIS_SEARCH !== 'true')(
  'description search queue startup with real Redis',
  () => {
    it('can prepare a memory after a fresh process connects', async () => {
      const mod = await setup();
      await mod.memorySearchQueue!.waitUntilReady();
      expect(await mod.queueMemorySearch('pilot-startup-test', 'one')).toBe(
        true,
      );
      expect(
        await mod.memorySearchQueue!.getJob('memory-pilot-startup-test-one'),
      ).toBeTruthy();
    });

    it('returns promptly while Redis is unavailable', async () => {
      const mod = await setup(1);
      const started = Date.now();
      expect(await mod.queueMemorySearch('pilot-startup-test', 'two')).toBe(
        false,
      );
      expect(Date.now() - started).toBeLessThan(1500);
    });
  },
);
