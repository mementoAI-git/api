import {randomUUID} from 'node:crypto';
import {v5 as uuidv5} from 'uuid';

export const ANALYTICS_SOURCE = 'api';
export const ANALYTICS_SCHEMA_VERSION = 1;
export function resolveAnalyticsEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.POSTHOG_ENVIRONMENT ||
    (env.MEMENTO_ENV === 'dev'
      ? 'staging'
      : env.MEMENTO_ENV === 'prod'
        ? 'production'
        : '') ||
    env.APP_ENV ||
    env.NODE_ENV ||
    'development'
  );
}
export const ANALYTICS_ENVIRONMENT = resolveAnalyticsEnvironment();

export type GrowthEventName =
  | 'growth_account_created'
  | 'growth_invitation_sent'
  | 'growth_invitation_converted'
  | 'growth_memory_captured'
  | 'growth_reflection_added'
  | 'growth_conversation_meaningful'
  | 'growth_connection_activated'
  | 'growth_connection_engaged'
  | 'growth_user_active'
  | 'analytics_setup_verified';

const PROPERTY_KEYS = [
  'inviter_id',
  'invitee_key',
  'invitation_id',
  'invitation_kind',
  'existing_user',
  'acquisition_source',
  'signup_at',
  'memory_id',
  'memory_kind',
  'conversation_id',
  'completed_exchanges',
  'connection_id',
  'other_user_id',
  'activity_type',
  'environment',
  'analytics_source',
  'analytics_schema_version',
  'is_test',
  'registration_method',
  'account_id',
  'channel',
] as const;
type PropertyKey = (typeof PROPERTY_KEYS)[number];
export type GrowthProperties = Partial<
  Record<PropertyKey, string | number | boolean>
>;
export interface GrowthEventInput {
  event: GrowthEventName;
  distinctId: string;
  key: string;
  properties: GrowthProperties;
  timestamp?: Date;
}
export interface OutboxEvent {
  key: string;
  uuid: string;
  event: GrowthEventName;
  distinctId: string;
  timestamp: Date;
  properties: GrowthProperties;
  attempts: number;
  nextAttemptAt: Date;
  owner?: string;
  leaseUntil?: Date;
  deliveredAt?: Date;
}
export interface GrowthOutboxStore {
  insert(event: OutboxEvent): Promise<void>;
  claim(now: Date, owner: string, until: Date): Promise<OutboxEvent | null>;
  delivered(key: string, owner: string, at: Date): Promise<void>;
  retry(key: string, owner: string, at: Date): Promise<void>;
}
export interface GrowthAnalyticsConfig {
  token: string;
  host: string;
}
/**
 * Why growth analytics is off, by setting name only (never values). Empty
 * means it is on. Kept beside readGrowthAnalyticsConfig so the startup log,
 * the deploy check and the real switch can never disagree.
 */
export function growthAnalyticsProblems(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV === 'test') return ['disabled while testing'];
  const problems: string[] = [];
  if (!env.POSTHOG_PROJECT_TOKEN?.trim())
    problems.push('POSTHOG_PROJECT_TOKEN is not set');
  const secret = env.POSTHOG_IDENTITY_SECRET?.trim().length || 0;
  if (!secret) problems.push('POSTHOG_IDENTITY_SECRET is not set');
  else if (secret < 32)
    problems.push(
      'POSTHOG_IDENTITY_SECRET is shorter than 32 characters (generate one with `openssl rand -hex 32`)',
    );
  if (!env.POSTHOG_HOST?.trim()) problems.push('POSTHOG_HOST is not set');
  else {
    try {
      const host = new URL(env.POSTHOG_HOST);
      if (
        host.protocol !== 'https:' ||
        host.username ||
        host.password ||
        host.search ||
        host.hash ||
        host.pathname !== '/'
      )
        problems.push(
          'POSTHOG_HOST must be a bare https origin such as https://us.i.posthog.com',
        );
    } catch {
      problems.push('POSTHOG_HOST is not a valid URL');
    }
  }
  return problems;
}

/** Problems that leave analytics on but make production reports miss events. */
export function growthAnalyticsWarnings(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const environment = resolveAnalyticsEnvironment(env);
  return env.MEMENTO_ENV === 'prod' && environment !== 'production'
    ? [
        `events are tagged environment "${environment}" on production; production reports only count "production". Set POSTHOG_ENVIRONMENT=production or remove it`,
      ]
    : [];
}

export function readGrowthAnalyticsConfig(
  env: NodeJS.ProcessEnv = process.env,
): (GrowthAnalyticsConfig & {identitySecret: string}) | null {
  if (growthAnalyticsProblems(env).length) return null;
  return {
    token: env.POSTHOG_PROJECT_TOKEN!.trim(),
    host: new URL(env.POSTHOG_HOST!).origin,
    identitySecret: env.POSTHOG_IDENTITY_SECRET!.trim(),
  };
}

function safeProperties(input: GrowthProperties): GrowthProperties {
  const properties: GrowthProperties = {};
  for (const key of PROPERTY_KEYS) {
    const value = input?.[key];
    if (
      (typeof value === 'string' && value.length <= 256) ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      properties[key] = value;
  }
  return {
    ...properties,
    analytics_source: ANALYTICS_SOURCE,
    analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
    environment: ANALYTICS_ENVIRONMENT,
  };
}

/** Injectable publisher: recording only writes the durable outbox, never HTTP. */
export function createGrowthAnalytics(options: {
  store: GrowthOutboxStore;
  publish: (rows: OutboxEvent[]) => Promise<void>;
  now?: () => Date;
  onError?: () => void;
}) {
  const now = options.now || (() => new Date());
  let flushing: Promise<void> | undefined;
  const reportError = () => {
    try {
      options.onError?.();
    } catch {
      /* optional diagnostics */
    }
  };
  async function record(input: GrowthEventInput): Promise<void> {
    try {
      if (
        !input.key ||
        !input.distinctId ||
        input.key.length > 512 ||
        input.distinctId.length > 256
      )
        return;
      const timestamp = input.timestamp || now();
      if (!Number.isFinite(timestamp.getTime())) return;
      await options.store.insert({
        ...input,
        uuid: uuidv5(
          `${ANALYTICS_ENVIRONMENT}:${input.event}:${input.key}`,
          uuidv5.URL,
        ),
        timestamp,
        properties: safeProperties(input.properties),
        attempts: 0,
        nextAttemptAt: now(),
      });
    } catch {
      reportError();
    }
  }
  async function deliver(): Promise<void> {
    const owner = randomUUID();
    for (let round = 0; round < 4; round++) {
      const rows: OutboxEvent[] = [];
      try {
        for (let n = 0; n < 50; n++) {
          const row = await options.store.claim(
            now(),
            owner,
            new Date(now().getTime() + 60_000),
          );
          if (!row) break;
          rows.push(row);
        }
        if (!rows.length) return;
        await options.publish(rows);
        for (const row of rows)
          await options.store.delivered(row.key, owner, now());
      } catch {
        reportError();
        for (const row of rows) {
          try {
            const delay = Math.min(
              3_600_000,
              1000 * 2 ** Math.min(row.attempts, 12),
            );
            await options.store.retry(
              row.key,
              owner,
              new Date(now().getTime() + delay),
            );
          } catch {
            reportError(); /* expired lease permits recovery */
          }
        }
        return;
      }
    }
  }
  function flush(): Promise<void> {
    if (!flushing)
      flushing = deliver()
        .catch(reportError)
        .finally(() => {
          flushing = undefined;
        });
    return flushing;
  }
  async function stop(): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        flush(),
        new Promise<void>(resolve => {
          deadline = setTimeout(resolve, 4000);
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
    // Any unacknowledged in-flight batch recovers through its durable lease.
  }
  return {record, flush, stop};
}
