import gemini, {GEMINI_MODEL} from '../../../../services/gemini';
import {recordAiMetric} from '../../../../services/ai/metrics';

const RETRY_DELAYS_MS = [1_000, 3_000];

function isRetryable(error: unknown): boolean {
  const status = (error as {status?: number})?.status;
  if (status === 429 || status === 500 || status === 503) return true;
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(
    String((error as Error)?.message),
  );
}

export type VoiceTextTask = 'voice_transcript_cleanup' | 'voice_call_summary';

/**
 * Runs one JSON-mode Gemini text request for post-call voice work and
 * records the usual AI metric. Returns the raw response text.
 */
export async function generateVoiceJson(
  task: VoiceTextTask,
  prompt: string,
  userId: string,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await generateOnce(task, prompt, userId);
    } catch (error) {
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !isRetryable(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function generateOnce(
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
