import {GEMINI_MODEL} from '../gemini';
import type {GroqMessage} from './groq';
import {groqClient, streamTextWithGroqFallback} from './groq';
import {deepSeekClient, streamTextWithDeepSeekFallback, type DeepSeekMessage} from './deepseek';
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

async function* createSafeFallbackStream(
  message: string,
): AsyncGenerator<{text?: string}, void, unknown> {
  yield {text: message};
}

export interface CriticalChatStreamParams {
  userId: string;
  requestStart: number;
  /** Latest user message text — drives Groq fast-mode selection */
  userTextForGroqRouting: string;
  systemInstruction: string;
  /** Prior turns only (user + assistant), excluding the latest user message */
  groqHistory: GroqMessage[];
  latestUserText: string;
  task: AiTask;
  metricsEndpoint: string;
  memoryIdForMetrics: string;
  /** Gemini streaming attempt after Groq fails or is unavailable */
  createGeminiStream: () => Promise<
    AsyncGenerator<{text?: string}, void, unknown>
  >;
  /** OpenRouter messages when Gemini fails */
  buildOpenRouterMessages: () => OpenRouterMessage[];
}

/**
 * Single provider cascade used by main host chat and onboarding chat:
 * Groq (primary → fallback per env) → Gemini → OpenRouter (task routing) → safe message.
 * Keeps model order aligned when either flow changes.
 */
export async function streamCriticalChatResponse(
  params: CriticalChatStreamParams,
): Promise<{
  stream: AsyncGenerator<{text?: string}, void, unknown>;
  modelLabel: string;
  /** When false, caller must not persist the user turn (matches `/ai/prompt` backoff behavior). */
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

  if (getUserBackoffRemainingMs(userId) > 0) {
    void recordAiMetric({
      event: 'user_backoff_short_circuit',
      task,
      endpoint: metricsEndpoint,
      user: userId,
      metadata: {remainingMs: getUserBackoffRemainingMs(userId)},
    });
    return {
      stream: createSafeFallbackStream(
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
  const groqModels = getGroqModelsForPrompt(userTextForGroqRouting);

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
      return {
        stream,
        modelLabel: `groq:${effectiveModel}`,
        recordUserMessageInDb: true,
      };
    } catch (error) {
      if (isProviderRateLimited(error)) setUserBackoffWindow(userId);
      console.error('AI routing fallback', {
        task,
        from: 'groq',
        to: 'gemini',
        reason: (error as Error)?.message,
      });
    }
  }

  // DeepSeek — between Groq and Gemini (key-gated, skipped if not configured)
  if (deepSeekClient.isConfigured()) {
    try {
      const deepSeekMessages: DeepSeekMessage[] = [
        {role: 'system', content: systemInstruction},
        ...groqHistory.map(m => ({role: m.role as 'system' | 'user' | 'assistant', content: m.content})),
        {role: 'user', content: latestUserText},
      ];
      const {stream, effectiveModel, usedFallback} = await streamTextWithDeepSeekFallback({
        messages: deepSeekMessages,
        temperature: 0.7,
        timeoutMs: 15_000,
      });
      console.log('AI routing', {task, provider: 'deepseek', effectiveModel, usedFallback, streamConnectMs: Date.now() - requestStart});
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
      return {stream, modelLabel: `deepseek:${effectiveModel}`, recordUserMessageInDb: true};
    } catch (deepSeekError) {
      if (isProviderRateLimited(deepSeekError)) setUserBackoffWindow(userId);
      console.error('AI routing fallback', {task, from: 'deepseek', to: 'gemini', reason: (deepSeekError as Error)?.message});
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
        reason: 'groq_failed_or_not_configured',
      },
    });
    return {
      stream: response,
      modelLabel: `gemini:${GEMINI_MODEL}`,
      recordUserMessageInDb: true,
    };
  } catch (geminiError) {
    if (isProviderRateLimited(geminiError)) setUserBackoffWindow(userId);
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
          stream,
          modelLabel: `openrouter:${effectiveModel}`,
          recordUserMessageInDb: true,
        };
      } catch (openrouterError) {
        if (isProviderRateLimited(openrouterError))
          setUserBackoffWindow(userId);
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
      stream: createSafeFallbackStream(
        'I am hitting temporary capacity limits right now. Please try again in about a minute.',
      ),
      modelLabel: 'fallback:capacity',
      recordUserMessageInDb: true,
    };
  }
}
