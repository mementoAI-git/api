import axios from 'axios';
import {Readable} from 'stream';
import {
  OPENROUTER_API_KEY,
  OPENROUTER_APP_NAME,
  OPENROUTER_BASE_URL,
  OPENROUTER_SITE_URL,
} from '../../utils/config';
import {AiTask, getTaskRouting} from './model-routing';

type ChatRole = 'system' | 'user' | 'assistant';
const OPENROUTER_COOLDOWN_MS = 30_000;
const taskCooldownUntil: Partial<Record<AiTask, number>> = {};

export interface OpenRouterMessage {
  role: ChatRole;
  content: string;
}

export interface OpenRouterTextResult {
  text: string;
  effectiveModel: string;
  usedFallback: boolean;
  durationMs: number;
  tokenUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function isConfigured() {
  return Boolean(OPENROUTER_API_KEY);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': OPENROUTER_SITE_URL,
    'X-Title': OPENROUTER_APP_NAME,
  };
}

function getMessageText(data: any) {
  return data?.choices?.[0]?.message?.content || '';
}

function getAxiosErrorDetails(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return {
      message: (error as Error)?.message || 'Unknown error',
    };
  }

  return {
    message: error.message,
    status: error.response?.status,
    responseData: error.response?.data,
  };
}

function getRetryDelayMs(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const retryAfterHeader = error.response?.headers?.['retry-after'];
  if (!retryAfterHeader) return null;

  const asNumber = Number(retryAfterHeader);
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    return asNumber * 1000;
  }
  return null;
}

function shouldOpenCircuit(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 429 || status === 402;
}

function isTaskCoolingDown(task: AiTask): boolean {
  const until = taskCooldownUntil[task];
  if (!until) return false;
  if (Date.now() > until) {
    delete taskCooldownUntil[task];
    return false;
  }
  return true;
}

function openTaskCooldown(task: AiTask, error: unknown) {
  const retryDelay = getRetryDelayMs(error);
  const cooldownMs =
    retryDelay && retryDelay > 0 ? retryDelay : OPENROUTER_COOLDOWN_MS;
  taskCooldownUntil[task] = Date.now() + cooldownMs;
}

async function generateWithModel(params: {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  timeoutMs: number;
}) {
  const response = await axios.post(
    `${OPENROUTER_BASE_URL}/chat/completions`,
    {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
    },
    {
      headers: getHeaders(),
      timeout: params.timeoutMs,
    },
  );

  return {
    text: getMessageText(response.data),
    tokenUsage: {
      prompt_tokens: response.data?.usage?.prompt_tokens,
      completion_tokens: response.data?.usage?.completion_tokens,
      total_tokens: response.data?.usage?.total_tokens,
    },
  };
}

export async function generateTextWithFallback(params: {
  task: AiTask;
  messages: OpenRouterMessage[];
  temperature?: number;
}): Promise<OpenRouterTextResult> {
  const route = getTaskRouting(params.task);
  const start = Date.now();

  if (isTaskCoolingDown(params.task)) {
    throw new Error(`OpenRouter circuit open for task: ${params.task}`);
  }

  try {
    const primary = await generateWithModel({
      model: route.primaryModel,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs: route.timeoutMs,
    });
    return {
      text: primary.text,
      effectiveModel: route.primaryModel,
      usedFallback: false,
      durationMs: Date.now() - start,
      tokenUsage: primary.tokenUsage,
    };
  } catch (primaryError) {
    try {
      const fallback = await generateWithModel({
        model: route.fallbackModel,
        messages: params.messages,
        temperature: params.temperature,
        timeoutMs: route.timeoutMs,
      });
      console.error('OpenRouter primary model failed, fallback used:', {
        task: params.task,
        primaryModel: route.primaryModel,
        fallbackModel: route.fallbackModel,
        primaryError: getAxiosErrorDetails(primaryError),
      });
      return {
        text: fallback.text,
        effectiveModel: route.fallbackModel,
        usedFallback: true,
        durationMs: Date.now() - start,
        tokenUsage: fallback.tokenUsage,
      };
    } catch (fallbackError) {
      if (shouldOpenCircuit(primaryError) || shouldOpenCircuit(fallbackError)) {
        openTaskCooldown(params.task, fallbackError);
      }
      console.error('OpenRouter primary and fallback both failed:', {
        task: params.task,
        primaryModel: route.primaryModel,
        fallbackModel: route.fallbackModel,
        primaryError: getAxiosErrorDetails(primaryError),
        fallbackError: getAxiosErrorDetails(fallbackError),
      });
      throw fallbackError;
    }
  }
}

async function streamWithModel(params: {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  timeoutMs: number;
}) {
  const response = await axios.post(
    `${OPENROUTER_BASE_URL}/chat/completions`,
    {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      stream: true,
    },
    {
      headers: getHeaders(),
      responseType: 'stream',
      timeout: params.timeoutMs,
    },
  );

  return response.data as Readable;
}

async function* parseSseStream(stream: Readable) {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const raw = trimmed.replace(/^data:\s*/, '');
      if (raw === '[DONE]') return;

      try {
        const payload = JSON.parse(raw);
        const token = payload?.choices?.[0]?.delta?.content;
        if (typeof token === 'string' && token.length > 0) {
          yield {text: token};
        }
      } catch (error) {
        // Ignore non-JSON events.
      }
    }
  }
}

export async function streamTextWithFallback(params: {
  task: AiTask;
  messages: OpenRouterMessage[];
  temperature?: number;
}): Promise<{
  stream: AsyncGenerator<{text?: string}, void, unknown>;
  effectiveModel: string;
  usedFallback: boolean;
  streamConnectMs: number;
}> {
  const route = getTaskRouting(params.task);
  const start = Date.now();

  if (isTaskCoolingDown(params.task)) {
    throw new Error(`OpenRouter circuit open for task: ${params.task}`);
  }

  try {
    const primaryStream = await streamWithModel({
      model: route.primaryModel,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs: route.timeoutMs,
    });
    return {
      stream: parseSseStream(primaryStream),
      effectiveModel: route.primaryModel,
      usedFallback: false,
      streamConnectMs: Date.now() - start,
    };
  } catch (primaryError) {
    try {
      const fallbackStream = await streamWithModel({
        model: route.fallbackModel,
        messages: params.messages,
        temperature: params.temperature,
        timeoutMs: route.timeoutMs,
      });
      console.error('OpenRouter primary stream failed, fallback used:', {
        task: params.task,
        primaryModel: route.primaryModel,
        fallbackModel: route.fallbackModel,
        primaryError: getAxiosErrorDetails(primaryError),
      });
      return {
        stream: parseSseStream(fallbackStream),
        effectiveModel: route.fallbackModel,
        usedFallback: true,
        streamConnectMs: Date.now() - start,
      };
    } catch (fallbackError) {
      if (shouldOpenCircuit(primaryError) || shouldOpenCircuit(fallbackError)) {
        openTaskCooldown(params.task, fallbackError);
      }
      console.error('OpenRouter primary and fallback streams both failed:', {
        task: params.task,
        primaryModel: route.primaryModel,
        fallbackModel: route.fallbackModel,
        primaryError: getAxiosErrorDetails(primaryError),
        fallbackError: getAxiosErrorDetails(fallbackError),
      });
      throw fallbackError;
    }
  }
}

export const openRouterClient = {
  isConfigured,
};
