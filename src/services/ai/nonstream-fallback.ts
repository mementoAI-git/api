import ai from './index';
import {type AiTask} from './model-routing';
import {type OpenRouterMessage} from './openrouter';

export interface ProviderFallbackTextResult {
  text: string;
  provider: string;
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
  return ai.size > 0;
}

export async function generateTextWithProviderFallback(params: {
  task: AiTask;
  messages: OpenRouterMessage[];
  temperature?: number;
}): Promise<ProviderFallbackTextResult> {
  const start = Date.now();
  
  // We map OpenRouterMessage to ChatMessage (which is the same shape)
  const result = await ai.generateText(params.messages);

  // Since AIRouter.generateText only returns the string, 
  // and doesn't currently expose which provider was used or token usage,
  // we provide best-effort metadata.
  return {
    text: result,
    provider: 'router',
    effectiveModel: 'routed-model',
    usedFallback: false, // AIRouter handles this internally
    durationMs: Date.now() - start,
  };
}
