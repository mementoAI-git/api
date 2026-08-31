import type {RequestContext} from '../contracts/response';
import {recordAiMetric} from './ai/metrics';

type CompatibilityContext = Pick<RequestContext, 'client'> &
  Partial<Pick<RequestContext, 'version' | 'build'>>;

export type CompatibilityEvent =
  | 'compat.auth.legacy_refresh'
  | 'compat.auth.legacy_session_shape'
  | 'compat.push.legacy_profile_token'
  | 'compat.users.profile_post'
  | 'compat.files.legacy_bare_url';

function bounded(value: string | null | undefined): string | undefined {
  return value ? value.slice(0, 128) : undefined;
}

export async function recordCompatibilityUse(
  event: CompatibilityEvent,
  context?: RequestContext | CompatibilityContext,
  metadata: Record<string, string | undefined> = {},
): Promise<void> {
  await recordAiMetric({
    event,
    metadata: {
      client: bounded(context?.client) || 'legacy-unknown',
      version: bounded(context?.version),
      build: bounded(context?.build),
      ...Object.fromEntries(
        Object.entries(metadata)
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([key, value]) => [key, bounded(value)]),
      ),
    },
  });
}
