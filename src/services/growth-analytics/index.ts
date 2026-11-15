import {
  ANALYTICS_ENVIRONMENT,
  createGrowthAnalytics,
  GrowthEventInput,
  growthAnalyticsProblems,
  growthAnalyticsWarnings,
  readGrowthAnalyticsConfig,
} from './core';
import logger from '../../utils/logger';
import {createPostHogPublisher} from './http';
import {createMongoGrowthOutboxStore} from './mongo';

export * from './core';
let analytics: ReturnType<typeof createGrowthAnalytics> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

export function isGrowthAnalyticsEnabled(): boolean {
  return readGrowthAnalyticsConfig() !== null;
}
function getAnalytics() {
  const config = readGrowthAnalyticsConfig();
  if (!config) return undefined;
  if (!analytics)
    analytics = createGrowthAnalytics({
      store: createMongoGrowthOutboxStore(),
      publish: createPostHogPublisher(config),
      onError: () => console.warn('Growth analytics operation deferred'),
    });
  return analytics;
}

export async function recordGrowthEvent(
  input: GrowthEventInput,
): Promise<void> {
  try {
    await getAnalytics()?.record(input);
  } catch {
    /* analytics never fails a user action */
  }
}
export async function flushGrowthAnalytics(): Promise<void> {
  try {
    await getAnalytics()?.flush();
  } catch {
    /* best effort; durable leases recover */
  }
}
/** Start after MongoDB connection; API and worker processes may both run this. */
/** One line at startup, so a misconfigured server can't drop events silently. */
export function reportGrowthAnalyticsStatus(
  log: Pick<typeof logger, 'info' | 'warn'> = logger,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'test') return;
  const problems = growthAnalyticsProblems(env);
  if (problems.length) {
    log.warn(
      `Growth analytics is off, no signups or activity are recorded: ${problems.join('; ')}`,
    );
    return;
  }
  log.info(`Growth analytics is on (environment "${ANALYTICS_ENVIRONMENT}")`);
  for (const warning of growthAnalyticsWarnings(env))
    log.warn(`Growth analytics: ${warning}`);
}

export function startGrowthAnalytics(): () => Promise<void> {
  reportGrowthAnalyticsStatus();
  if (isGrowthAnalyticsEnabled() && !timer) {
    timer = setInterval(() => {
      void flushGrowthAnalytics();
    }, 5000);
    timer.unref();
    void flushGrowthAnalytics();
  }
  return async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    try {
      await getAnalytics()?.stop();
    } catch {
      /* durable leases recover */
    }
  };
}
