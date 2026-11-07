import type {GroqMessage} from './groq';
import {
  GROQ_FAST_MODE_ENABLED,
  GROQ_FAST_MODE_MAX_INPUT_CHARS,
  GROQ_MODEL_CHAT_FAST_FALLBACK,
  GROQ_MODEL_CHAT_FAST_PRIMARY,
  GROQ_MODEL_CHAT_FALLBACK,
  GROQ_MODEL_CHAT_PRIMARY,
} from '../../utils/config';

const GROQ_MAX_CONTEXT_CHARS = 120000;
export const GROQ_SYSTEM_PROMPT_CAP_CHARS = 35000;
/** Kept word for word: about ten exchanges, enough for a reflection to build on itself. */
const GROQ_RECENT_HISTORY_TURNS = 20;
/**
 * The end of the system prompt is kept whole when it has to be shortened:
 * that is where this message's lookups, actions and reply rules are added.
 */
const GROQ_SYSTEM_PROMPT_TAIL_CHARS = 14000;
const SHORTENED_NOTE =
  '\n\n[Some older reference context was left out here to fit. Do not guess what it said.]\n\n';

function compactText(text: string, maxChars: number) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

/**
 * Shortens a system prompt from the middle. Its start is the conversation
 * policy and its end is this message's context; the bulk in between is the
 * stored memories, the part that can best be spared.
 */
export function fitSystemPrompt(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text || '';
  const tail = Math.min(
    GROQ_SYSTEM_PROMPT_TAIL_CHARS,
    Math.floor(maxChars * 0.4),
  );
  const head = Math.max(0, maxChars - tail - SHORTENED_NOTE.length);
  return text.slice(0, head) + SHORTENED_NOTE + text.slice(-tail);
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

  let boundedSystem = fitSystemPrompt(
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
    boundedSystem = fitSystemPrompt(
      params.systemInstruction,
      Math.floor(GROQ_SYSTEM_PROMPT_CAP_CHARS * 0.6),
    );
  }

  const result: GroqMessage[] = [{role: 'system', content: boundedSystem}];
  if (summaryMessage) {
    // A note, not a turn: as an assistant turn the model took it for
    // something it had said.
    result.push({role: 'system', content: summaryMessage});
  }
  result.push(...recent);
  result.push({role: 'user', content: params.userText});
  return result;
}

/**
 * Short messages may use the faster, smaller model, but only to open a
 * conversation. Mid-conversation, a short message ("you there?", "yes")
 * still needs everything said so far, which the larger model handles better.
 */
export function getGroqModelsForPrompt(
  userText: string,
  options: {hasHistory?: boolean} = {},
): {
  primaryModel: string;
  fallbackModel: string;
  fastMode: boolean;
} {
  if (
    GROQ_FAST_MODE_ENABLED &&
    !options.hasHistory &&
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
