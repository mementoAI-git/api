import gemini, {GEMINI_MODEL} from '../../../../services/gemini';
import ai from '../../../../services/ai';
import {recordAiMetric} from '../../../../services/ai/metrics';

const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Only brief overloads are worth retrying. A 429 is usually the free tier's
 * daily quota, which a few seconds of waiting cannot fix.
 */
function isRetryable(error: unknown): boolean {
  const status = (error as {status?: number})?.status;
  if (status === 500 || status === 503) return true;
  return /UNAVAILABLE|high demand/i.test(String((error as Error)?.message));
}

export type VoiceTextTask = 'voice_transcript_cleanup' | 'voice_call_summary';

export type GenerateVoiceJsonOptions = {
  /** Rejects an answer that cannot be used, so the next source is tried. */
  accept?: (raw: string) => boolean;
  retryDelaysMs?: readonly number[];
};

/**
 * Runs one JSON text request for post-call voice work. Like the rest of the
 * API it goes through the provider router first, which rotates providers and
 * cools down any that hit a rate limit, and calls Gemini directly last.
 * Returns the raw response text.
 */
export async function generateVoiceJson(
  task: VoiceTextTask,
  prompt: string,
  userId: string,
  options: GenerateVoiceJsonOptions = {},
): Promise<string> {
  const accept = options.accept ?? (() => true);

  if (ai.size > 0) {
    const routed = await generateWithRouter(task, prompt, userId);
    if (routed !== null && accept(routed)) return routed;
  }

  const retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await generateWithGemini(task, prompt, userId);
    } catch (error) {
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !isRetryable(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function generateWithRouter(
  task: VoiceTextTask,
  prompt: string,
  userId: string,
): Promise<string | null> {
  const start = Date.now();
  try {
    const text = await ai.generateText([
      {
        role: 'system',
        content: 'You reply with a single JSON object and nothing else.',
      },
      {role: 'user', content: prompt},
    ]);
    void recordAiMetric({
      event: 'ai_route',
      task,
      provider: 'router',
      user: userId,
      duration_ms: Date.now() - start,
    });
    return text;
  } catch (error) {
    void recordAiMetric({
      event: 'ai_route',
      task,
      provider: 'router',
      user: userId,
      duration_ms: Date.now() - start,
      error_message: String((error as Error)?.message),
    });
    return null;
  }
}

async function generateWithGemini(
  task: VoiceTextTask,
  prompt: string,
  userId: string,
): Promise<string> {
  const start = Date.now();
  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {responseMimeType: 'application/json', temperature: 0.2},
    });
    void recordAiMetric({
      event: 'ai_route',
      task,
      provider: 'gemini',
      model: GEMINI_MODEL,
      user: userId,
      duration_ms: Date.now() - start,
      token_usage: {
        prompt_tokens: response.usageMetadata?.promptTokenCount,
        completion_tokens: response.usageMetadata?.candidatesTokenCount,
        total_tokens: response.usageMetadata?.totalTokenCount,
      },
    });
    return response.text ?? '';
  } catch (error) {
    void recordAiMetric({
      event: 'ai_route',
      task,
      provider: 'gemini',
      model: GEMINI_MODEL,
      user: userId,
      duration_ms: Date.now() - start,
      error_message: String((error as Error)?.message),
    });
    throw error;
  }
}
