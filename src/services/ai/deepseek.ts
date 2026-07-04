/**
 * DeepSeek direct API adapter
 *
 * DeepSeek's API is OpenAI-compatible — same endpoint shape as Groq.
 * Enable by setting DEEPSEEK_API_KEY in the environment.
 *
 * Default models:
 *   Primary:  deepseek-chat      (DeepSeek-V3 — fast, great quality)
 *   Fallback: deepseek-reasoner  (DeepSeek-R1 — slower, stronger reasoning)
 *
 * Base URL: https://api.deepseek.com/v1
 */

import axios from 'axios';
import {Readable} from 'stream';
import {
  DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL_CHAT_PRIMARY,
  DEEPSEEK_MODEL_CHAT_FALLBACK,
} from '../../utils/config';

type ChatRole = 'system' | 'user' | 'assistant';

export interface DeepSeekMessage {
  role: ChatRole;
  content: string;
}

export interface DeepSeekTextResult {
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

function isConfigured(): boolean {
  return Boolean(DEEPSEEK_API_KEY);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ─── Streaming ─────────────────────────────────────────────────────────────────

async function streamWithModel(params: {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  timeoutMs: number;
}): Promise<Readable> {
  const response = await axios.post(
    `${DEEPSEEK_BASE_URL}/chat/completions`,
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

function parseSSEStream(
  readable: Readable,
): AsyncGenerator<{text?: string}, void, unknown> {
  return (async function* () {
    let buffer = '';
    for await (const chunk of readable) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) yield {text: content};
        } catch {
          // malformed SSE chunk — skip
        }
      }
    }
  })();
}

export async function streamTextWithDeepSeekFallback(params: {
  messages: DeepSeekMessage[];
  temperature?: number;
  timeoutMs: number;
  primaryModel?: string;
  fallbackModel?: string;
}): Promise<{
  stream: AsyncGenerator<{text?: string}, void, unknown>;
  effectiveModel: string;
  usedFallback: boolean;
}> {
  const primary = params.primaryModel ?? DEEPSEEK_MODEL_CHAT_PRIMARY;
  const fallback = params.fallbackModel ?? DEEPSEEK_MODEL_CHAT_FALLBACK;

  try {
    const readable = await streamWithModel({
      model: primary,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs: params.timeoutMs,
    });
    return {
      stream: parseSSEStream(readable),
      effectiveModel: primary,
      usedFallback: false,
    };
  } catch (primaryError) {
    console.warn('DeepSeek primary failed, trying fallback', {
      primary,
      fallback,
      reason: (primaryError as Error)?.message,
    });
    const readable = await streamWithModel({
      model: fallback,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs: params.timeoutMs,
    });
    return {
      stream: parseSSEStream(readable),
      effectiveModel: fallback,
      usedFallback: true,
    };
  }
}

// ─── Non-streaming ─────────────────────────────────────────────────────────────

async function generateWithModel(params: {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  timeoutMs: number;
}) {
  const response = await axios.post(
    `${DEEPSEEK_BASE_URL}/chat/completions`,
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
    text: response.data?.choices?.[0]?.message?.content || '',
    tokenUsage: {
      prompt_tokens: response.data?.usage?.prompt_tokens,
      completion_tokens: response.data?.usage?.completion_tokens,
      total_tokens: response.data?.usage?.total_tokens,
    },
  };
}

export async function generateTextWithDeepSeekFallback(params: {
  messages: DeepSeekMessage[];
  temperature?: number;
  timeoutMs?: number;
  primaryModel?: string;
  fallbackModel?: string;
}): Promise<DeepSeekTextResult> {
  const primary = params.primaryModel ?? DEEPSEEK_MODEL_CHAT_PRIMARY;
  const fallback = params.fallbackModel ?? DEEPSEEK_MODEL_CHAT_FALLBACK;
  const timeoutMs = params.timeoutMs ?? 20_000;
  const start = Date.now();

  try {
    const {text, tokenUsage} = await generateWithModel({
      model: primary,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs,
    });
    return {text, effectiveModel: primary, usedFallback: false, durationMs: Date.now() - start, tokenUsage};
  } catch {
    const {text, tokenUsage} = await generateWithModel({
      model: fallback,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs,
    });
    return {text, effectiveModel: fallback, usedFallback: true, durationMs: Date.now() - start, tokenUsage};
  }
}

// ─── Client export (mirrors groqClient pattern) ────────────────────────────────

export const deepSeekClient = {isConfigured};
