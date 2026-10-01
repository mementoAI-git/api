import {
  GEMINI_API_KEY,
  GROQ_API_KEY,
  DEEPSEEK_API_KEY,
  CEREBRAS_API_KEY,
  NVIDIA_NIM_API_KEY,
  SAMBANOVA_API_KEY,
  OPENROUTER_API_KEY,
  CLOUDFLARE_AI_API_KEY,
  CLOUDFLARE_AI_ACCOUNT_ID,
  GROQ_BASE_URL,
  GROQ_MODEL_CHAT_PRIMARY,
  GROQ_MODEL_CHAT_FALLBACK,
  OPENROUTER_BASE_URL,
  OR_MODEL_CHAT_PRIMARY,
  OR_MODEL_CHAT_FALLBACK,
} from '../../utils/config';
import {GeminiProvider} from './providers/gemini';
import {OpenAICompatProvider} from './providers/openai-compat';
import {AIRouter} from './router';

const ai = new AIRouter();

// --- Tier 1 providers (ordered by quality × generosity) ---

if (GROQ_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'groq',
      baseUrl: GROQ_BASE_URL,
      apiKey: GROQ_API_KEY,
      models: [GROQ_MODEL_CHAT_PRIMARY, GROQ_MODEL_CHAT_FALLBACK],
    }),
  );
}

if (GEMINI_API_KEY) {
  ai.register(new GeminiProvider());
}

if (DEEPSEEK_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: DEEPSEEK_API_KEY,
      models: ['deepseek-chat'],
    }),
  );
}

if (NVIDIA_NIM_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: NVIDIA_NIM_API_KEY,
      models: ['meta/llama-3.1-405b-instruct'],
    }),
  );
}

if (CEREBRAS_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'cerebras',
      baseUrl: 'https://api.cerebras.ai/v1',
      apiKey: CEREBRAS_API_KEY,
      models: ['qwen-3-235b-a22b'],
    }),
  );
}

if (SAMBANOVA_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'sambanova',
      baseUrl: 'https://api.sambanova.ai/v1',
      apiKey: SAMBANOVA_API_KEY,
      models: ['Meta-Llama-3.1-405B-Instruct'],
    }),
  );
}

if (OPENROUTER_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'openrouter',
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: OPENROUTER_API_KEY,
      models: [OR_MODEL_CHAT_PRIMARY, OR_MODEL_CHAT_FALLBACK],
    }),
  );
}

if (CLOUDFLARE_AI_API_KEY && CLOUDFLARE_AI_ACCOUNT_ID) {
  ai.register(
    new OpenAICompatProvider({
      name: 'cloudflare',
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_AI_ACCOUNT_ID}/ai/v1`,
      apiKey: CLOUDFLARE_AI_API_KEY,
      models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    }),
  );
}

export default ai;
