import {getTaskRouting, type AiTask} from './model-routing';
import {
  generateTextWithFallback,
  openRouterClient,
  type OpenRouterMessage,
} from './openrouter';
import {
  deepSeekClient,
  generateTextWithDeepSeekFallback,
  type DeepSeekMessage,
} from './deepseek';

export interface ProviderFallbackTextResult {
  text: string;
  provider: 'openrouter' | 'deepseek';
  effectiveModel: string;
  usedFallback: boolean;
  durationMs: number;
  tokenUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function isNonStreamingProviderFallbackConfigured(): boolean {
  return openRouterClient.isConfigured() || deepSeekClient.isConfigured();
}

function toDeepSeekMessages(messages: OpenRouterMessage[]): DeepSeekMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
  }));
}

export async function generateTextWithProviderFallback(params: {
  task: AiTask;
  messages: OpenRouterMessage[];
  temperature?: number;
}): Promise<ProviderFallbackTextResult> {
  let openRouterError: unknown;

  if (openRouterClient.isConfigured()) {
    try {
      const result = await generateTextWithFallback(params);
      return {
        ...result,
        provider: 'openrouter',
      };
    } catch (error) {
      openRouterError = error;
    }
  }

  if (deepSeekClient.isConfigured()) {
    const route = getTaskRouting(params.task);
    const result = await generateTextWithDeepSeekFallback({
      messages: toDeepSeekMessages(params.messages),
      temperature: params.temperature,
      timeoutMs: route.timeoutMs,
    });
    return {
      ...result,
      provider: 'deepseek',
    };
  }

  if (openRouterError) {
    throw openRouterError;
  }

  throw new Error(
    `No non-streaming AI provider configured for task: ${params.task}`,
  );
}
