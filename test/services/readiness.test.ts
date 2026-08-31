import {describe, expect, it} from 'vitest';
import {
  checkReadiness,
  createReadinessProbe,
  type ReadinessChecks,
} from '../../src/services/readiness';
import {
  publishWorkerHeartbeat,
  startReadyWorkerHeartbeat,
  startWorkerHeartbeat,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from '../../src/services/worker-heartbeat';
import {EventEmitter} from 'events';

function healthyChecks(): ReadinessChecks {
  return {
    mongo: async () => undefined,
    redis: async () => undefined,
    storage: async () => undefined,
    worker: async () => undefined,
  };
}

describe('readiness checks', () => {
  it('is ready only when every required dependency is healthy', async () => {
    const result = await checkReadiness(healthyChecks());

    expect(result.ready).toBe(true);
    expect(result.dependencies).toEqual({
      mongo: 'ok',
      redis: 'ok',
      storage: 'ok',
      worker: 'ok',
    });
  });

  it.each(['mongo', 'redis', 'storage', 'worker'] as const)(
    'is not ready when %s is unavailable',
    async dependency => {
      const checks = healthyChecks();
      checks[dependency] = async () => {
        throw new Error('connection string should never leave this check');
      };

      const result = await checkReadiness(checks);

      expect(result.ready).toBe(false);
      expect(result.dependencies[dependency]).toBe('unavailable');
      expect(JSON.stringify(result)).not.toContain('connection string');
    },
  );

  it('coalesces and briefly caches dependency probes', async () => {
    let calls = 0;
    const checks = healthyChecks();
    checks.storage = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 5));
    };
    const probe = createReadinessProbe(checks, 5_000);

    await Promise.all([probe(), probe()]);
    await probe();

    expect(calls).toBe(1);
  });
});

describe('worker heartbeat', () => {
  it('stores a bounded shared heartbeat for a separate worker process', async () => {
    const values = new Map<string, string>();
    let connected = false;
    let ttl = 0;
    const client = {
      get isOpen() {
        return connected;
      },
      async connect() {
        connected = true;
      },
      async set(key: string, value: string, options: {EX: number}) {
        values.set(key, value);
        ttl = options.EX;
      },
      async del(key: string) {
        values.delete(key);
      },
    };

    await publishWorkerHeartbeat(client, 1_725_000_000_000);

    expect(JSON.parse(values.get(WORKER_HEARTBEAT_KEY) || '{}')).toMatchObject({
      timestamp: 1_725_000_000_000,
    });
    expect(ttl).toBe(WORKER_HEARTBEAT_TTL_SECONDS);
  });

  it('removes its heartbeat when a worker shuts down', async () => {
    const values = new Map<string, string>();
    const client = {
      isOpen: true,
      async connect() {},
      async set(key: string, value: string) {
        values.set(key, value);
      },
      async del(key: string) {
        values.delete(key);
      },
    };

    const heartbeat = await startWorkerHeartbeat(client);
    await heartbeat.stop();

    expect(values.has(WORKER_HEARTBEAT_KEY)).toBe(false);
  });

  it('does not remove a replacement worker heartbeat during a rolling restart', async () => {
    const values = new Map<string, string>();
    const client = {
      isOpen: true,
      async connect() {},
      async set(key: string, value: string) {
        values.set(key, value);
      },
      async del(key: string) {
        values.delete(key);
      },
      async eval(
        _script: string,
        options: {keys: string[]; arguments: string[]},
      ) {
        const value = values.get(options.keys[0]);
        if (!value || JSON.parse(value).owner !== options.arguments[0])
          return 0;
        values.delete(options.keys[0]);
        return 1;
      },
    };

    const previous = await startWorkerHeartbeat(client);
    const replacement = await startWorkerHeartbeat(client);
    await previous.stop();

    expect(values.has(WORKER_HEARTBEAT_KEY)).toBe(true);
    await replacement.stop();
    expect(values.has(WORKER_HEARTBEAT_KEY)).toBe(false);
  });

  it('publishes only after consumers are ready and suppresses on worker failure', async () => {
    const values = new Map<string, string>();
    const client = {
      isOpen: true,
      async connect() {},
      async set(key: string, value: string) {
        values.set(key, value);
      },
      async del(key: string) {
        values.delete(key);
      },
    };
    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => {
      resolveReady = resolve;
    });
    const events = new EventEmitter();
    const worker = Object.assign(events, {
      waitUntilReady: () => ready,
    });

    let unhealthyCalls = 0;
    const starting = startReadyWorkerHeartbeat([worker], client, () => {
      unhealthyCalls++;
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(values.has(WORKER_HEARTBEAT_KEY)).toBe(false);

    resolveReady();
    const heartbeat = await starting;
    expect(values.has(WORKER_HEARTBEAT_KEY)).toBe(true);

    events.emit('error', new Error('worker connection lost'));
    await expect.poll(() => values.has(WORKER_HEARTBEAT_KEY)).toBe(false);
    expect(unhealthyCalls).toBe(1);
    await heartbeat.stop();
  });
});
