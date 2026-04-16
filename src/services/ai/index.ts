import {
  GEMINI_API_KEY,
  GROQ_API_KEY,
  CEREBRAS_API_KEY,
  NVIDIA_NIM_API_KEY,
  SAMBANOVA_API_KEY,
  OPENROUTER_API_KEY,
  CLOUDFLARE_AI_API_KEY,
  CLOUDFLARE_AI_ACCOUNT_ID,
} from '../../utils/config';
import {GeminiProvider} from './providers/gemini';
import {OpenAICompatProvider} from './providers/openai-compat';
import {AIRouter} from './router';

const ai = new AIRouter();

// --- Tier 1 providers (ordered by quality × generosity) ---

if (NVIDIA_NIM_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: NVIDIA_NIM_API_KEY,
      model: 'meta/llama-3.1-405b-instruct',
    }),
  );
}

if (GROQ_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: GROQ_API_KEY,
      model: 'llama-3.3-70b-versatile',
    }),
  );
}

if (CEREBRAS_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'cerebras',
      baseUrl: 'https://api.cerebras.ai/v1',
      apiKey: CEREBRAS_API_KEY,
      model: 'qwen-3-235b-a22b',
    }),
  );
}

if (SAMBANOVA_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'sambanova',
      baseUrl: 'https://api.sambanova.ai/v1',
      apiKey: SAMBANOVA_API_KEY,
      model: 'Meta-Llama-3.1-405B-Instruct',
    }),
  );
}

// Gemini as a text-only provider in the pool (always available since the app requires GEMINI_API_KEY)
if (GEMINI_API_KEY) {
  ai.register(new GeminiProvider());
}

if (OPENROUTER_API_KEY) {
  ai.register(
    new OpenAICompatProvider({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
      model: 'meta-llama/llama-3.3-70b-instruct:free',
    }),
  );
}

if (CLOUDFLARE_AI_API_KEY && CLOUDFLARE_AI_ACCOUNT_ID) {
  ai.register(
    new OpenAICompatProvider({
      name: 'cloudflare',
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_AI_ACCOUNT_ID}/ai/v1`,
      apiKey: CLOUDFLARE_AI_API_KEY,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    }),
  );
}

export default ai;
