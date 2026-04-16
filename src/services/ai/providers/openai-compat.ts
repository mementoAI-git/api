import logger from '../../../utils/logger';
import {AIProvider, ChatMessage} from '../types';

interface OpenAICompatConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
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
  private model: string;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    // Ensure baseUrl does not end with a slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generateText(messages: ChatMessage[]): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
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
