/**
 * Retries a Gemini call that hit a rate limit (429) or a temporary outage
 * (503), waiting as long as Google asks ("Please retry in 18.9s", or the
 * RetryInfo retryDelay), else backing off exponentially. Other errors are
 * thrown at once. Paid keys have per-minute limits too, so the scheduled
 * sweep and the backfill both need this.
 */

const DEFAULT_ATTEMPTS = 5;
const MAX_WAIT_MS = 60_000;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function statusOf(error: unknown): number | undefined {
  const status = (error as {status?: unknown})?.status;
  return typeof status === 'number' ? status : undefined;
}

/** How long Google asked us to wait, if it said. */
export function retryDelayMs(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const inText = message.match(/retry in ([\d.]+)\s*s/i);
  if (inText) return Math.ceil(Number(inText[1]) * 1_000);
  const inInfo = message.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  if (inInfo) return Math.ceil(Number(inInfo[1]) * 1_000);
  return undefined;
}

export async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  options: {attempts?: number; sleep?: Sleep} = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const status = statusOf(error);
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt >= attempts) throw error;
      const wait = retryDelayMs(error) ?? 2_000 * 2 ** (attempt - 1);
      await sleep(Math.min(wait + 250, MAX_WAIT_MS));
    }
  }
}
