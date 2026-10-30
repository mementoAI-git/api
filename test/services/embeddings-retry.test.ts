import {describe, expect, it} from 'vitest';

import {
  retryDelayMs,
  withRateLimitRetry,
} from '../../src/services/embeddings/retry';

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), {status});
}

// The exact text Gemini returned on the dev server's backfill.
const QUOTA_MESSAGE =
  '{"error":{"code":429,"message":"You exceeded your current quota ... Please retry in 18.9695949s.","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"18s"}]}}';

describe('withRateLimitRetry', () => {
  it('reads the wait Google asks for', () => {
    expect(retryDelayMs(apiError(429, QUOTA_MESSAGE))).toBe(18_970);
    expect(retryDelayMs(apiError(429, '{"retryDelay":"7s"}'))).toBe(7_000);
    expect(retryDelayMs(apiError(429, 'busy'))).toBeUndefined();
  });

  it('waits and retries after a rate limit, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withRateLimitRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw apiError(429, QUOTA_MESSAGE);
        return 'ok';
      },
      {sleep: async ms => void waits.push(ms)},
    );
    expect(result).toBe('ok');
    expect(waits).toEqual([19_220, 19_220]);
  });

  it('gives up after the last attempt', async () => {
    await expect(
      withRateLimitRetry(
        async () => Promise.reject(apiError(503, 'unavailable')),
        {
          attempts: 3,
          sleep: async () => undefined,
        },
      ),
    ).rejects.toThrow('unavailable');
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      withRateLimitRetry(
        async () => {
          calls += 1;
          throw apiError(400, 'bad request');
        },
        {sleep: async () => undefined},
      ),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });
});
