import logger from '../../utils/logger';
import {AIProvider, ChatMessage, ProviderState} from './types';

/** How long (ms) to skip a provider after a 429 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export class AIRouter {
  private providers: ProviderState[] = [];
  private currentIndex = 0;

  register(provider: AIProvider): void {
    this.providers.push({provider, rateLimitedUntil: 0});
    logger.info(`AI router: registered provider "${provider.name}"`);
  }

  get size(): number {
    return this.providers.length;
  }

  /**
   * Send a prompt through the provider pool.
   * Tries round-robin, skipping rate-limited providers,
   * falling back to the next on error.
   */
  async generateText(messages: ChatMessage[]): Promise<string> {
    const now = Date.now();
    const eligible = this.providers.filter(p => p.rateLimitedUntil <= now);

    // If every provider is on cooldown, use the one whose cooldown expires soonest
    const pool =
      eligible.length > 0
        ? eligible
        : [...this.providers].sort(
            (a, b) => a.rateLimitedUntil - b.rateLimitedUntil,
          );

    const errors: Array<{name: string; error: string}> = [];

    for (let i = 0; i < pool.length; i++) {
      const idx = (this.currentIndex + i) % pool.length;
      const entry = pool[idx];

      try {
        const result = await entry.provider.generateText(messages);
        // Advance pointer so the next call starts at the following provider
        this.currentIndex = (idx + 1) % pool.length;
        return result;
      } catch (err: any) {
        const isRateLimit = err?.status === 429;
        const isPaymentRequired = err?.status === 402;

        if (isRateLimit || isPaymentRequired) {
          entry.rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          logger.warn(
            `AI router: ${entry.provider.name} ${
              isPaymentRequired ? 'payment required' : 'rate-limited'
            }, cooling down for ${RATE_LIMIT_COOLDOWN_MS / 1000}s`,
          );
        } else {
          logger.error(err, `AI router: ${entry.provider.name} failed`);
        }

        errors.push({
          name: entry.provider.name,
          error: err?.message || 'unknown error',
        });
      }
    }

    throw new Error(
      `All AI providers failed: ${errors.map(e => `${e.name}: ${e.error}`).join('; ')}`,
    );
  }
}
