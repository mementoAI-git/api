import {HeadBucketCommand} from '@aws-sdk/client-s3';
import mongoose from '../module/database/connection';
import redisClient from './redis';
import {cloudflareClient, getStorageTarget} from './storage/s3';
import {AWS_S3_BUCKET_NAME, CLOUDFLARE_R2_BUCKET_NAME} from '../utils/config';
import {WORKER_HEARTBEAT_KEY} from './worker-heartbeat';

export const READINESS_TIMEOUT_MS = 2_000;
export const WORKER_HEARTBEAT_MAX_AGE_MS = 90_000;

export type ReadinessDependency = 'mongo' | 'redis' | 'storage' | 'worker';
export type ReadinessDependencyStatus = 'ok' | 'unavailable';

export type ReadinessResult = {
  ready: boolean;
  checked_at: string;
  dependencies: Record<ReadinessDependency, ReadinessDependencyStatus>;
};

export type ReadinessChecks = Record<ReadinessDependency, () => Promise<void>>;

function withTimeout(operation: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    operation,
    new Promise<void>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('readiness check timed out')),
        READINESS_TIMEOUT_MS,
      );
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function checkMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB is not connected');
  }
}

async function checkRedis(): Promise<void> {
  if (!redisClient.isReady) {
    throw new Error('Redis is not ready');
  }
  await redisClient.ping();
}

async function checkStorage(): Promise<void> {
  const bucket = CLOUDFLARE_R2_BUCKET_NAME || AWS_S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('Storage bucket is not configured');
  }

  const target = getStorageTarget();
  await cloudflareClient.send(new HeadBucketCommand({Bucket: target.bucket}));
}

async function checkWorkerHeartbeat(): Promise<void> {
  const value = await redisClient.get(WORKER_HEARTBEAT_KEY);
  if (typeof value !== 'string' || !value) {
    throw new Error('Worker heartbeat is unavailable');
  }

  const heartbeat = JSON.parse(value) as {timestamp?: unknown};
  if (
    typeof heartbeat.timestamp !== 'number' ||
    !Number.isFinite(heartbeat.timestamp) ||
    Date.now() - heartbeat.timestamp > WORKER_HEARTBEAT_MAX_AGE_MS
  ) {
    throw new Error('Worker heartbeat is stale');
  }
}

export const runtimeReadinessChecks: ReadinessChecks = {
  mongo: checkMongo,
  redis: checkRedis,
  storage: checkStorage,
  worker: checkWorkerHeartbeat,
};

export async function checkReadiness(
  checks: ReadinessChecks = runtimeReadinessChecks,
): Promise<ReadinessResult> {
  const entries = await Promise.all(
    (
      Object.entries(checks) as Array<
        [ReadinessDependency, () => Promise<void>]
      >
    ).map(async ([name, check]) => {
      try {
        await withTimeout(Promise.resolve().then(check));
        return [name, 'ok'] as const;
      } catch {
        return [name, 'unavailable'] as const;
      }
    }),
  );

  const dependencies = Object.fromEntries(entries) as Record<
    ReadinessDependency,
    ReadinessDependencyStatus
  >;
  return {
    ready: Object.values(dependencies).every(status => status === 'ok'),
    checked_at: new Date().toISOString(),
    dependencies,
  };
}

export function createReadinessProbe(
  checks: ReadinessChecks = runtimeReadinessChecks,
  cacheTtlMs = 5_000,
): () => Promise<ReadinessResult> {
  let cached: ReadinessResult | null = null;
  let cachedUntil = 0;
  let inFlight: Promise<ReadinessResult> | null = null;

  return async () => {
    if (cached && Date.now() < cachedUntil) return cached;
    if (inFlight) return inFlight;

    inFlight = checkReadiness(checks)
      .then(result => {
        cached = result;
        cachedUntil = Date.now() + cacheTtlMs;
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

export const getReadiness = createReadinessProbe();
