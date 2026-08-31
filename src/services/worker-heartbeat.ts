import redisClient from './redis';
import logger from '../utils/logger';
import {randomUUID} from 'crypto';

export const WORKER_HEARTBEAT_KEY = 'runtime:worker:heartbeat';
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;

type HeartbeatClient = {
  isOpen: boolean;
  connect(): Promise<unknown>;
  set(key: string, value: string, options: {EX: number}): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval?(
    script: string,
    options: {keys: string[]; arguments: string[]},
  ): Promise<unknown>;
};

type ReadyWorker = {
  waitUntilReady(): Promise<unknown>;
  on(event: 'error' | 'closed', listener: (error?: Error) => void): unknown;
  off(event: 'error' | 'closed', listener: (error?: Error) => void): unknown;
};

const DELETE_OWN_HEARTBEAT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, decoded = pcall(cjson.decode, current)
if ok and decoded.owner == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function publishWorkerHeartbeat(
  client: HeartbeatClient = redisClient,
  now = Date.now(),
  owner = `worker-${process.pid}`,
): Promise<void> {
  if (!client.isOpen) {
    await client.connect();
  }

  await client.set(
    WORKER_HEARTBEAT_KEY,
    JSON.stringify({timestamp: now, pid: process.pid, owner}),
    {EX: WORKER_HEARTBEAT_TTL_SECONDS},
  );
}

export async function startWorkerHeartbeat(
  client: HeartbeatClient = redisClient,
): Promise<{stop(): Promise<void>}> {
  const owner = randomUUID();
  await publishWorkerHeartbeat(client, Date.now(), owner);

  const timer = setInterval(() => {
    void publishWorkerHeartbeat(client, Date.now(), owner).catch(error => {
      logger.warn({err: error}, 'Worker heartbeat update failed');
    });
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      try {
        if (client.eval) {
          await client.eval(DELETE_OWN_HEARTBEAT_SCRIPT, {
            keys: [WORKER_HEARTBEAT_KEY],
            arguments: [owner],
          });
        } else {
          await client.del(WORKER_HEARTBEAT_KEY);
        }
      } catch (error) {
        logger.warn({err: error}, 'Worker heartbeat cleanup failed');
      }
    },
  };
}

export async function startReadyWorkerHeartbeat(
  workers: ReadyWorker[],
  client: HeartbeatClient = redisClient,
  onUnhealthy: (error?: Error) => void = () => undefined,
): Promise<{stop(): Promise<void>}> {
  let heartbeat: Awaited<ReturnType<typeof startWorkerHeartbeat>> | null = null;
  let unhealthy = false;
  let stopPromise: Promise<void> | null = null;

  let unhealthyHandled = false;
  const suppressHeartbeat = (error?: Error) => {
    unhealthy = true;
    if (heartbeat && !stopPromise) {
      stopPromise = heartbeat.stop();
      void stopPromise.finally(() => {
        if (!unhealthyHandled) {
          unhealthyHandled = true;
          onUnhealthy(error);
        }
      });
    }
  };
  for (const worker of workers) {
    worker.on('error', suppressHeartbeat);
    worker.on('closed', suppressHeartbeat);
  }

  const removeListeners = () => {
    for (const worker of workers) {
      worker.off('error', suppressHeartbeat);
      worker.off('closed', suppressHeartbeat);
    }
  };

  try {
    await Promise.all(workers.map(worker => worker.waitUntilReady()));
    if (unhealthy) throw new Error('A queue worker failed during startup');
    heartbeat = await startWorkerHeartbeat(client);
    if (unhealthy) {
      await heartbeat.stop();
      throw new Error('A queue worker failed during heartbeat startup');
    }
  } catch (error) {
    removeListeners();
    throw error;
  }

  return {
    async stop(): Promise<void> {
      removeListeners();
      if (!stopPromise) stopPromise = heartbeat!.stop();
      await stopPromise;
    },
  };
}
