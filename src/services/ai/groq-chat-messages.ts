import type {GroqMessage} from './groq';
import {
  GROQ_FAST_MODE_ENABLED,
  GROQ_FAST_MODE_MAX_INPUT_CHARS,
  GROQ_MODEL_CHAT_FAST_FALLBACK,
  GROQ_MODEL_CHAT_FAST_PRIMARY,
  GROQ_MODEL_CHAT_FALLBACK,
  GROQ_MODEL_CHAT_PRIMARY,
} from '../../utils/config';

const GROQ_MAX_CONTEXT_CHARS = 22000;
const GROQ_SYSTEM_PROMPT_CAP_CHARS = 5000;
const GROQ_RECENT_HISTORY_TURNS = 8;

function compactText(text: string, maxChars: number) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

/**
 * Bounded Groq messages with system prompt preserved — shared by main `/ai/prompt`
 * and onboarding chat so long transcripts stay within limits without dropping instructions.
 */
export function buildGroqBoundedMessages(params: {
  systemInstruction: string;
  history: GroqMessage[];
  userText: string;
}): GroqMessage[] {
  const history = params.history || [];
  const older = history.slice(
    0,
    Math.max(0, history.length - GROQ_RECENT_HISTORY_TURNS),
  );
  const recent = history.slice(-GROQ_RECENT_HISTORY_TURNS);

  let summaryMessage = '';
  if (older.length > 0) {
    const olderSnippet = older
      .slice(-6)
      .map(m => `${m.role}: ${compactText(m.content, 260)}`)
      .join('\n');
    summaryMessage = `Summary of earlier conversation turns (compressed to fit model limits):\n${olderSnippet}`;
  }

  let boundedSystem = compactText(
    params.systemInstruction,
    GROQ_SYSTEM_PROMPT_CAP_CHARS,
  );
  const assembled = [
    boundedSystem,
    summaryMessage,
    ...recent.map(m => `${m.role}: ${m.content}`),
    `user: ${params.userText}`,
  ].join('\n\n');

  if (assembled.length > GROQ_MAX_CONTEXT_CHARS) {
    boundedSystem = compactText(
      boundedSystem,
      Math.floor(GROQ_SYSTEM_PROMPT_CAP_CHARS * 0.6),
    );
  }

  const result: GroqMessage[] = [{role: 'system', content: boundedSystem}];
  if (summaryMessage) {
    result.push({role: 'assistant', content: summaryMessage});
  }
  result.push(...recent);
  result.push({role: 'user', content: params.userText});
  return result;
}

export function getGroqModelsForPrompt(userText: string): {
  primaryModel: string;
  fallbackModel: string;
  fastMode: boolean;
} {
  if (
    GROQ_FAST_MODE_ENABLED &&
    (userText || '').trim().length <= GROQ_FAST_MODE_MAX_INPUT_CHARS
  ) {
    return {
      primaryModel: GROQ_MODEL_CHAT_FAST_PRIMARY,
      fallbackModel: GROQ_MODEL_CHAT_FAST_FALLBACK,
      fastMode: true,
    };
  }
  return {
    primaryModel: GROQ_MODEL_CHAT_PRIMARY,
    fallbackModel: GROQ_MODEL_CHAT_FALLBACK,
    fastMode: false,
  };
}
