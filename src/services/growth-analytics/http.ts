import type {GrowthAnalyticsConfig, OutboxEvent} from './core';

/** Official public batch ingestion endpoint; no user-agent, IP or person traits. */
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
            $process_person_profile: false,
          },
        })),
      }),
    });
    // Do not log the response body: ingestion errors can echo event contents.
    if (!response.ok) throw new Error('Growth analytics delivery failed');
    await response.body?.cancel();
  };
}
