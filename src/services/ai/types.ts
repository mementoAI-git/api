export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  /** Human-readable name used in logs and rate-limit tracking */
  name: string;

  /**
   * Send a prompt and return the full text response.
   * The caller is responsible for parsing (e.g. extractJson).
   */
  generateText(messages: ChatMessage[]): Promise<string>;
}

export interface ProviderState {
  provider: AIProvider;
  /** Timestamp (ms) until which this provider should be skipped */
  rateLimitedUntil: number;
}
