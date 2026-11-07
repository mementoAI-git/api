import {GEMINI_MODEL} from '../gemini';
import type {GroqMessage} from './groq';
import {
  generateTextWithGroqFallback,
  groqClient,
  streamTextWithGroqFallback,
} from './groq';
import {
  deepSeekClient,
  streamTextWithDeepSeekFallback,
  type DeepSeekMessage,
} from './deepseek';
import {
  openRouterClient,
  streamTextWithFallback,
  type OpenRouterMessage,
} from './openrouter';
import {OPENROUTER_CRITICAL_ENABLED} from '../../utils/config';
import {recordAiMetric} from './metrics';
import {
  getUserBackoffRemainingMs,
  isProviderRateLimited,
  setUserBackoffWindow,
} from './chat-user-backoff';
import {
  buildGroqBoundedMessages,
  getGroqModelsForPrompt,
} from './groq-chat-messages';
import type {AiTask} from './model-routing';

type ChatStreamChunk = {text?: string};

/**
 * Hard output-level writing constraints for Memento chat.
 *
 * Prompt instructions are probabilistic. This runs after generation so
 * prohibited dash punctuation never reaches the client through this stream.
 *
 * Em dash:
 *   "word \u2014 word" -> "word, word"
 *   "word\u2014word"   -> "word, word"
 *
 * En dash:
 *   spaced prose use -> comma
 *   compact range use, e.g. "3\u20135" -> "3-5"
 */
export function sanitizeMementoText(text: string): string {
  if (!text) return text;

  return (
    text
      // Em dash used as prose punctuation.
      // Use horizontal whitespace only so paragraph/newline structure is preserved.
      .replace(/[ \t]*\u2014[ \t]*/g, ', ')

      // Spaced en dash used as prose punctuation.
      .replace(/[ \t]+\u2013[ \t]+/g, ', ')

      // Remaining en dashes are most likely compact ranges.
      .replace(/\u2013/g, '-')

      // Clean artifacts caused by punctuation replacement.
      .replace(/[ \t]+,/g, ',')
      .replace(/,[ \t]*,+/g, ', ')
      .replace(/[ \t]{2,}/g, ' ')
  );
}

/**
 * Provider-independent output boundary for Memento's streamed chat text.
 *
 * Keep all hard response-format constraints here rather than duplicating them
 * across Groq, DeepSeek, Gemini, and OpenRouter integrations.
 */
async function* sanitizeMementoStream(
  stream: AsyncGenerator<ChatStreamChunk, void, unknown>,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  for await (const chunk of stream) {
    if (!chunk.text) {
      yield chunk;
      continue;
    }

    yield {
      ...chunk,
      text: sanitizeMementoText(chunk.text),
    };
  }
}

/** Said when no model produced a reply, so the host is never left with nothing. */
export const EMPTY_REPLY_MESSAGE =
  'Sorry, I lost my train of thought there. Could you send that again?';

/**
 * A stream that ends, or fails, before any text would leave the host with no
 * reply at all. Then the reply is asked for once more without streaming, and
 * failing that the host is told to resend.
 */
export async function* withEmptyReplyRecovery(
  stream: AsyncGenerator<ChatStreamChunk, void, unknown>,
  recover: () => Promise<string>,
  onRecover?: (reason: string) => void,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  let replied = false;
  try {
    for await (const chunk of stream) {
      if (chunk.text?.trim()) replied = true;
      yield chunk;
    }
  } catch (error) {
    if (replied) throw error;
    onRecover?.(`stream_error: ${(error as Error)?.message}`);
  }
  if (replied) return;
  onRecover?.('empty_stream');
  let text = '';
  try {
    text = (await recover()).trim();
  } catch {
    text = '';
  }
  yield {text: text || EMPTY_REPLY_MESSAGE};
}

async function* createSafeFallbackStream(
  message: string,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  yield {text: message};
}

function createSanitizedSafeFallbackStream(
  message: string,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  return sanitizeMementoStream(createSafeFallbackStream(message));
}

export interface CriticalChatStreamParams {
  userId: string;
  requestStart: number;

  /** Latest user message text. Drives Groq fast-mode selection. */
  userTextForGroqRouting: string;

  systemInstruction: string;

  /** Prior turns only (user + assistant), excluding the latest user message. */
  groqHistory: GroqMessage[];

  latestUserText: string;
  task: AiTask;
  metricsEndpoint: string;
  memoryIdForMetrics: string;

  /** Gemini streaming attempt after Groq and DeepSeek fail or are unavailable. */
  createGeminiStream: () => Promise<
    AsyncGenerator<ChatStreamChunk, void, unknown>
  >;

  /** OpenRouter messages when Gemini fails. */
  buildOpenRouterMessages: () => OpenRouterMessage[];
}

/**
 * Single provider cascade used by main host chat and onboarding chat:
 *
 * Groq (primary -> fallback per env)
 * -> DeepSeek
 * -> Gemini
 * -> OpenRouter (task routing)
 * -> safe fallback message
 *
 * Every successful provider stream passes through sanitizeMementoStream before
 * it is returned to the caller.
 */
export async function streamCriticalChatResponse(
  params: CriticalChatStreamParams,
): Promise<{
  stream: AsyncGenerator<ChatStreamChunk, void, unknown>;
  modelLabel: string;

  /**
   * When false, caller must not persist the user turn.
   * Matches `/ai/prompt` backoff behavior.
   */
  recordUserMessageInDb: boolean;
}> {
  const {
    userId,
    requestStart,
    userTextForGroqRouting,
    systemInstruction,
    groqHistory,
    latestUserText,
    task,
    metricsEndpoint,
    memoryIdForMetrics,
    createGeminiStream,
    buildOpenRouterMessages,
  } = params;

  const backoffRemainingMs = getUserBackoffRemainingMs(userId);

  if (backoffRemainingMs > 0) {
    void recordAiMetric({
      event: 'user_backoff_short_circuit',
      task,
      endpoint: metricsEndpoint,
      user: userId,
      metadata: {
        remainingMs: backoffRemainingMs,
      },
    });

    return {
      stream: createSanitizedSafeFallbackStream(
        'I am recovering from temporary AI capacity limits. Please retry in a few seconds.',
      ),
      modelLabel: 'fallback:backoff',
      recordUserMessageInDb: false,
    };
  }

  const chatMessages = buildGroqBoundedMessages({
    systemInstruction,
    history: groqHistory,
    userText: latestUserText,
  });

  const groqModels = getGroqModelsForPrompt(userTextForGroqRouting, {
    hasHistory: groqHistory.length > 0,
  });

  if (groqClient.isConfigured()) {
    try {
      const {stream, effectiveModel, usedFallback} =
        await streamTextWithGroqFallback({
          messages: chatMessages,
          temperature: 0.7,
          timeoutMs: 15_000,
          primaryModel: groqModels.primaryModel,
          fallbackModel: groqModels.fallbackModel,
        });

      console.log('AI routing', {
        task,
        provider: 'groq',
        effectiveModel,
        usedFallback,
        fastMode: groqModels.fastMode,
        streamConnectMs: Date.now() - requestStart,
      });

      void recordAiMetric({
        event: 'ai_route',
        task,
        endpoint: metricsEndpoint,
        provider: 'groq',
        model: effectiveModel,
        user: userId,
        memory: memoryIdForMetrics,
        used_fallback: usedFallback,
        stream_connect_ms: Date.now() - requestStart,
        fast_mode: groqModels.fastMode,
      });

      const recovered = withEmptyReplyRecovery(
        stream,
        async () =>
          (
            await generateTextWithGroqFallback({
              messages: chatMessages,
              temperature: 0.7,
              timeoutMs: 15_000,
              // The other model first: the one that just came back empty
              // is likely to again.
              primaryModel: usedFallback
                ? groqModels.primaryModel
                : groqModels.fallbackModel,
              fallbackModel: effectiveModel,
            })
          ).text,
        reason => {
          void recordAiMetric({
            event: 'chat_empty_reply_recovery',
            task,
            endpoint: metricsEndpoint,
            provider: 'groq',
            model: effectiveModel,
            user: userId,
            memory: memoryIdForMetrics,
            error_message: reason,
          });
        },
      );

      return {
        stream: sanitizeMementoStream(recovered),
        modelLabel: `groq:${effectiveModel}`,
        recordUserMessageInDb: true,
      };
    } catch (error) {
      if (isProviderRateLimited(error)) {
        setUserBackoffWindow(userId);
      }

      console.error('AI routing fallback', {
        task,
        from: 'groq',
        to: 'deepseek',
        reason: (error as Error)?.message,
      });
    }
  }

  // DeepSeek sits between Groq and Gemini.
  // It is key-gated and skipped when not configured.
  if (deepSeekClient.isConfigured()) {
    try {
      const deepSeekMessages: DeepSeekMessage[] = [
        {
          role: 'system',
          content: systemInstruction,
        },
        ...groqHistory.map(message => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content: message.content,
        })),
        {
          role: 'user',
          content: latestUserText,
        },
      ];

      const {stream, effectiveModel, usedFallback} =
        await streamTextWithDeepSeekFallback({
          messages: deepSeekMessages,
          temperature: 0.7,
          timeoutMs: 15_000,
        });

      console.log('AI routing', {
        task,
        provider: 'deepseek',
        effectiveModel,
        usedFallback,
        streamConnectMs: Date.now() - requestStart,
      });

      void recordAiMetric({
        event: 'ai_route',
        task,
        endpoint: metricsEndpoint,
        provider: 'deepseek',
        model: effectiveModel,
        user: userId,
        memory: memoryIdForMetrics,
        used_fallback: usedFallback,
        stream_connect_ms: Date.now() - requestStart,
      });

      return {
        stream: sanitizeMementoStream(stream),
        modelLabel: `deepseek:${effectiveModel}`,
        recordUserMessageInDb: true,
      };
    } catch (deepSeekError) {
      if (isProviderRateLimited(deepSeekError)) {
        setUserBackoffWindow(userId);
      }

      console.error('AI routing fallback', {
        task,
        from: 'deepseek',
        to: 'gemini',
        reason: (deepSeekError as Error)?.message,
      });
    }
  }

  try {
    const response = await createGeminiStream();

    console.log('AI routing', {
      task,
      provider: 'gemini',
      streamConnectMs: Date.now() - requestStart,
    });

    void recordAiMetric({
      event: 'ai_route',
      task,
      endpoint: metricsEndpoint,
      provider: 'gemini',
      model: GEMINI_MODEL,
      user: userId,
      memory: memoryIdForMetrics,
      stream_connect_ms: Date.now() - requestStart,
      metadata: {
        reason: 'groq_and_deepseek_failed_or_not_configured',
      },
    });

    return {
      stream: sanitizeMementoStream(response),
      modelLabel: `gemini:${GEMINI_MODEL}`,
      recordUserMessageInDb: true,
    };
  } catch (geminiError) {
    if (isProviderRateLimited(geminiError)) {
      setUserBackoffWindow(userId);
    }

    console.error('AI routing fallback', {
      task,
      from: 'gemini',
      to: 'openrouter',
      reason: (geminiError as Error)?.message,
    });

    if (OPENROUTER_CRITICAL_ENABLED && openRouterClient.isConfigured()) {
      try {
        const {stream, effectiveModel, usedFallback} =
          await streamTextWithFallback({
            task,
            messages: buildOpenRouterMessages(),
            temperature: 0.7,
          });

        console.log('AI routing', {
          task,
          provider: 'openrouter',
          effectiveModel,
          usedFallback,
          streamConnectMs: Date.now() - requestStart,
        });

        void recordAiMetric({
          event: 'ai_route',
          task,
          endpoint: metricsEndpoint,
          provider: 'openrouter',
          model: effectiveModel,
          user: userId,
          memory: memoryIdForMetrics,
          used_fallback: usedFallback,
          stream_connect_ms: Date.now() - requestStart,
        });

        return {
          stream: sanitizeMementoStream(stream),
          modelLabel: `openrouter:${effectiveModel}`,
          recordUserMessageInDb: true,
        };
      } catch (openrouterError) {
        if (isProviderRateLimited(openrouterError)) {
          setUserBackoffWindow(userId);
        }

        console.error('AI routing exhausted', {
          task,
          provider: 'openrouter',
          reason: (openrouterError as Error)?.message,
        });

        void recordAiMetric({
          event: 'ai_route_error',
          task,
          endpoint: metricsEndpoint,
          provider: 'openrouter',
          user: userId,
          memory: memoryIdForMetrics,
          error_message: (openrouterError as Error)?.message,
        });
      }
    }

    return {
      stream: createSanitizedSafeFallbackStream(
        'I am hitting temporary capacity limits right now. Please try again in about a minute.',
      ),
      modelLabel: 'fallback:capacity',
      recordUserMessageInDb: true,
    };
  }
}
