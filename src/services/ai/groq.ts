import https from 'https';
import axios from 'axios';
import {Readable} from 'stream';
import {
  GROQ_API_KEY,
  GROQ_BASE_URL,
  GROQ_MODEL_CHAT_PRIMARY,
  GROQ_MODEL_CHAT_FALLBACK,
} from '../../utils/config';

type ChatRole = 'system' | 'user' | 'assistant';

export interface GroqMessage {
  role: ChatRole;
  content: string;
}

function isConfigured() {
  return Boolean(GROQ_API_KEY);
}

/**
 * One warm connection to Groq, reused by every request: a fresh TLS
 * handshake per chat message added about 300 ms before the first word.
 */
const groqAgent = new https.Agent({keepAlive: true, maxSockets: 32});

function getHeaders() {
  return {
    Authorization: `Bearer ${GROQ_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * gpt-oss models think before they answer; for chat replies a little
 * thinking is plenty and the first word comes sooner.
 */
export function reasoningFor(model: string): {reasoning_effort?: 'low'} {
  return /gpt-oss/i.test(model) ? {reasoning_effort: 'low'} : {};
}

async function streamWithModel(params: {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  timeoutMs: number;
}) {
  const response = await axios.post(
    `${GROQ_BASE_URL}/chat/completions`,
    {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      stream: true,
      ...reasoningFor(params.model),
    },
    {
      headers: getHeaders(),
      responseType: 'stream',
      timeout: params.timeoutMs,
      httpsAgent: groqAgent,
    },
  );

  return response.data as Readable;
}

async function generateWithModel(params: {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  timeoutMs: number;
}) {
  const response = await axios.post(
    `${GROQ_BASE_URL}/chat/completions`,
    {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
    },
    {
      headers: getHeaders(),
      timeout: params.timeoutMs,
      httpsAgent: groqAgent,
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
      } catch (_error) {
        // Ignore malformed intermediary chunks.
      }
    }
  }
}

export async function streamTextWithGroqFallback(params: {
  messages: GroqMessage[];
  temperature?: number;
  timeoutMs?: number;
  primaryModel?: string;
  fallbackModel?: string;
}) {
  const timeoutMs = params.timeoutMs ?? 15_000;
  const primaryModel = params.primaryModel || GROQ_MODEL_CHAT_PRIMARY;
  const fallbackModel = params.fallbackModel || GROQ_MODEL_CHAT_FALLBACK;
  try {
    const primary = await streamWithModel({
      model: primaryModel,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs,
    });
    return {
      stream: parseSseStream(primary),
      effectiveModel: primaryModel,
      usedFallback: false,
    };
  } catch (_primaryError) {
    const fallback = await streamWithModel({
      model: fallbackModel,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs,
    });
    return {
      stream: parseSseStream(fallback),
      effectiveModel: fallbackModel,
      usedFallback: true,
    };
  }
}

export async function generateTextWithGroqFallback(params: {
  messages: GroqMessage[];
  temperature?: number;
  timeoutMs?: number;
  primaryModel?: string;
  fallbackModel?: string;
}) {
  const timeoutMs = params.timeoutMs ?? 15_000;
  const primaryModel = params.primaryModel || GROQ_MODEL_CHAT_PRIMARY;
  const fallbackModel = params.fallbackModel || GROQ_MODEL_CHAT_FALLBACK;
  try {
    const primary = await generateWithModel({
      model: primaryModel,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs,
    });
    return {
      text: primary.text,
      effectiveModel: primaryModel,
      usedFallback: false,
      tokenUsage: primary.tokenUsage,
    };
  } catch (_primaryError) {
    const fallback = await generateWithModel({
      model: fallbackModel,
      messages: params.messages,
      temperature: params.temperature,
      timeoutMs,
    });
    return {
      text: fallback.text,
      effectiveModel: fallbackModel,
      usedFallback: true,
      tokenUsage: fallback.tokenUsage,
    };
  }
}

export type GroqToolCall = {name: string; arguments: Record<string, unknown>};

/**
 * Asks a model which tools to call, without streaming and without an answer:
 * returns the tool calls it chose (none is a valid choice).
 */
export async function chooseToolCallsWithGroq(params: {
  model: string;
  messages: GroqMessage[];
  tools: readonly {name: string; description: string; parameters: unknown}[];
  timeoutMs: number;
  maxCalls?: number;
}): Promise<GroqToolCall[]> {
  const response = await axios.post(
    `${GROQ_BASE_URL}/chat/completions`,
    {
      model: params.model,
      messages: params.messages,
      tools: params.tools.map(tool => ({type: 'function', function: tool})),
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: 400,
      ...reasoningFor(params.model),
    },
    {
      headers: getHeaders(),
      timeout: params.timeoutMs,
      httpsAgent: groqAgent,
    },
  );
  const calls: {function?: {name?: string; arguments?: string}}[] =
    response.data?.choices?.[0]?.message?.tool_calls ?? [];
  return calls
    .flatMap(call => {
      const name = call.function?.name;
      if (!name) return [];
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        return [
          {name, arguments: args && typeof args === 'object' ? args : {}},
        ];
      } catch {
        return [];
      }
    })
    .slice(0, params.maxCalls ?? 3);
}

export const groqClient = {
  isConfigured,
};
