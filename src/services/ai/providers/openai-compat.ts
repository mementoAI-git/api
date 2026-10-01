import logger from '../../../utils/logger';
import {AIProvider, ChatMessage} from '../types';

interface OpenAICompatConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Tried in order; the next one is used when a model is missing or retired. */
  models: string[];
}

/** 404 means the model is gone; 400 can mean it is not served for this key. */
function isModelUnavailable(status: number, body: string): boolean {
  if (status === 404) return true;
  return status === 400 && /model/i.test(body);
}

/**
 * Generic provider for any API that implements the OpenAI
 * `POST /chat/completions` contract (Groq, Cerebras, NVIDIA NIM,
 * SambaNova, Cloudflare Workers AI, OpenRouter, etc.).
 */
export class OpenAICompatProvider implements AIProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private models: string[];

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    // Ensure baseUrl does not end with a slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.models = [...new Set(config.models.filter(Boolean))];
    if (this.models.length === 0) {
      throw new Error(`${config.name}: at least one model is required`);
    }
  }

  async generateText(messages: ChatMessage[]): Promise<string> {
    let lastError: unknown;
    for (const [index, model] of this.models.entries()) {
      try {
        return await this.generateWithModel(model, messages);
      } catch (error) {
        lastError = error;
        const isLast = index === this.models.length - 1;
        if (
          isLast ||
          !(error as {modelUnavailable?: boolean}).modelUnavailable
        ) {
          throw error;
        }
        logger.warn(
          `${this.name}: model ${model} is unavailable, trying ${this.models[index + 1]}`,
        );
      }
    }
    throw lastError;
  }

  private async generateWithModel(
    model: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
      }),
    });

    if (res.status === 429) {
      const err = new Error(`Rate limited by ${this.name}`);
      (err as any).status = 429;
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(
        `${this.name} returned ${res.status}: ${body.slice(0, 200)}`,
      );
      (err as any).status = res.status;
      (err as any).modelUnavailable = isModelUnavailable(res.status, body);
      throw err;
    }

    const data: any = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error(`${this.name} returned an empty response`);
    }

    return text;
  }
}
