import gemini, {GEMINI_MODEL} from '../../gemini';
import {AIProvider, ChatMessage} from '../types';

/**
 * Wraps the existing Gemini SDK so it can participate in the
 * round-robin router alongside OpenAI-compatible providers.
 *
 * Only used for text-only generateContent calls.
 * Streaming chat, transcription, and multimodal calls still use
 * the Gemini SDK directly.
 */
export class GeminiProvider implements AIProvider {
  name = 'gemini';

  async generateText(messages: ChatMessage[]): Promise<string> {
    // Separate system message from user messages
    const systemMsg = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    // Map user/assistant messages into proper multi-turn content for the SDK
    const contents = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{text: m.content}],
    }));

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: systemMsg ? {systemInstruction: systemMsg.content} : undefined,
    });

    if (!response.text) {
      throw new Error('Gemini returned an empty response');
    }

    return response.text;
  }
}

