import type {GrowthAnalyticsConfig, OutboxEvent} from './core';

/**
 * The signup event creates the account's PostHog person, holding only
 * non-identifying traits (signup time, how they joined, environment), so
 * cohorts and retention can include every account. Later events stay
 * person-less and attach to that person by distinct ID.
 */
function personFields(row: OutboxEvent) {
  if (row.event !== 'growth_account_created')
    return {$process_person_profile: false};
  const traits: Record<string, unknown> = {
    signed_up_at: row.timestamp.toISOString(),
  };
  for (const key of [
    'acquisition_source',
    'registration_method',
    'environment',
  ] as const)
    if (row.properties[key] !== undefined) traits[key] = row.properties[key];
  return {$process_person_profile: true, $set_once: traits};
}

/** Official public batch ingestion endpoint; no user-agent, IP or contact details. */
export function createPostHogPublisher(
  config: GrowthAnalyticsConfig,
  send: (input: string, init: RequestInit) => Promise<Response> = fetch,
) {
  return async (rows: OutboxEvent[]): Promise<void> => {
    const response = await send(`${config.host}/batch/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'memento-growth-analytics/1',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        token: config.token,
        batch: rows.map(row => ({
          event: row.event,
          uuid: row.uuid,
          timestamp: row.timestamp.toISOString(),
          properties: {
            ...row.properties,
            distinct_id: row.distinctId,
            $geoip_disable: true,
            ...personFields(row),
          },
        })),
      }),
    });
    // Do not log the response body: ingestion errors can echo event contents.
    if (!response.ok) throw new Error('Growth analytics delivery failed');
    await response.body?.cancel();
  };
}
