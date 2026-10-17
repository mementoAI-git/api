import {HydratedDocument} from 'mongoose';
import {IUser} from '../../../database/model/user';
import {prompts} from '../../../../utils';
import {getLongTermContext} from '../../../../services/embeddings/long-term';
import {MEMORY_RETRIEVAL} from '../../../../utils/config';
import {findOwnedMemory} from '../../memory/access';
import {
  buildVoiceGreetingInstruction,
  buildVoiceSystemInstruction,
} from '../../../../utils/ai-prompt/voice';
import {
  formatTranscriptLines,
  getRecentConversationLines,
} from './transcript-context';
import {withTimeout} from './with-timeout';
import {buildHostOverview} from './host-overview';
import {describeHostNow} from './local-time';
import type {StepTimer} from '../../../../utils/step-timer';
import {getCachedJson, setCachedJson} from '../../../../services/redis';

const DEFAULT_LONG_TERM_TIMEOUT_MS = 1_500;
const HOST_OVERVIEW_TIMEOUT_MS = 1_500;
const MAX_TRANSCRIPT_LINES = 20;
const MAX_NOTES_CHARS = 400;

export type VoiceSessionContext = {
  systemInstruction: string;
  greetingInstruction: string;
  memoryId?: string;
};

/** Stands in for the recalled memories until they arrive. */
const LONG_TERM_PLACEHOLDER = '\u0000LONG_TERM_CONTEXT\u0000';

function reflectionTopicOf(
  memory: {prompt_text?: unknown; type?: unknown; title?: unknown} | null,
): string | undefined {
  return (
    String(memory?.prompt_text || '').trim() ||
    (memory?.type === 'story' ? String(memory?.title || '').trim() : '') ||
    undefined
  );
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function buildVoiceSessionContext(
  user: HydratedDocument<IUser>,
  memoryId?: string,
  options: {
    longTermTimeoutMs?: number;
    memoryTool?: boolean;
    callActions?: boolean;
    serverTools?: boolean;
    screenControl?: boolean;
    screenFields?: boolean;
    timeZone?: string;
    timer?: StepTimer;
  } = {},
): Promise<VoiceSessionContext> {
  const userId = String(user._id);
  const time = <T>(name: string, work: () => Promise<T>) =>
    options.timer ? options.timer.time(`context.${name}`, work) : work();

  // Every read below is a database round trip, so they all start at once:
  // the conversation, its recent lines, the host overview and the base
  // context. Only the recall waits, for the topic it looks up.

  // Unowned, malformed or stale IDs must never block a call or leak another
  // user's data. Promise.resolve().then() also catches synchronous throws.
  const memoryReady = memoryId
    ? time('memory', () =>
        Promise.resolve()
          .then(() => findOwnedMemory(memoryId, userId))
          .catch(() => null),
      )
    : Promise.resolve(null);
  // Scoped to the host's own messages, so an unowned ID finds nothing.
  const linesReady = memoryId
    ? time('lines', () =>
        Promise.resolve()
          .then(() =>
            getRecentConversationLines(userId, memoryId, MAX_TRANSCRIPT_LINES),
          )
          .catch(() => []),
      )
    : Promise.resolve([]);

  // What to recall at the start: the reflection, else what the host last
  // said in this conversation. Without either there is nothing specific to
  // look up, and the host overview and profile already cover the basics.
  const longTermReady = Promise.all([memoryReady, linesReady]).then(
    ([memory, recent]) => {
      const lastHostLine = [...recent]
        .reverse()
        .find(line => line.speaker === 'Host')?.text;
      const topic =
        reflectionTopicOf(memory) ||
        lastHostLine ||
        (MEMORY_RETRIEVAL === 'supermemory'
          ? 'ongoing life, recent conversations and people'
          : '');
      return time('recall', () =>
        getLongTermContext(userId, topic).catch(() => ''),
      );
    },
  );

  // The base context only needs the recall for one block, so it is built
  // with a placeholder there and does not wait for it.
  const baseReady = linesReady.then(recent =>
    time('base', () =>
      prompts.createSystemContext(
        user,
        memoryId,
        null,
        LONG_TERM_PLACEHOLDER,
        recent.filter(line => line.speaker === 'Host').length,
        // With memory search, details are looked up instead of carried.
        {compact: Boolean(options.memoryTool)},
      ),
    ).catch(error => {
      console.error(
        'Failed to build base system context for voice mode:',
        error,
      );
      return '';
    }),
  );

  const [memory, lines, longTermContext, hostOverview, base] =
    await Promise.all([
      memoryReady,
      linesReady,
      withTimeout(
        longTermReady,
        options.longTermTimeoutMs ?? DEFAULT_LONG_TERM_TIMEOUT_MS,
        '',
      ),
      withTimeout(
        time('overview', () => buildHostOverview(userId).catch(() => '')),
        HOST_OVERVIEW_TIMEOUT_MS,
        '',
      ),
      baseReady,
    ]);
  const ownedMemoryId = memory ? String(memory._id) : undefined;
  const reflectionTopic = reflectionTopicOf(memory);
  const memoryNotes =
    memory?.type === 'story'
      ? stripHtml(String(memory?.body || '')).slice(0, MAX_NOTES_CHARS) ||
        undefined
      : undefined;
  const baseContext = base.replace(
    LONG_TERM_PLACEHOLDER,
    () => longTermContext,
  );

  const name = String(
    (user as any).nickname || (user as any).first_name || '',
  ).trim();

  return {
    systemInstruction: buildVoiceSystemInstruction(baseContext, {
      hostNow: describeHostNow(options.timeZone),
      hostOverview,
      recentTranscript: formatTranscriptLines(lines),
      reflectionTopic,
      memoryNotes,
      memoryTool: options.memoryTool,
      callActions: options.callActions,
      serverTools: options.serverTools,
      screenControl: options.screenControl,
      screenFields: options.screenFields,
    }),
    greetingInstruction: buildVoiceGreetingInstruction({
      name: name || undefined,
      hasRecentTurns: lines.length > 0,
      reflectionTopic,
    }),
    memoryId: ownedMemoryId,
  };
}

/** Longer than a call can sensibly reconnect within; the token lasts 30 min. */
export const VOICE_CONTEXT_REUSE_SECONDS = 35 * 60;

type ContextOptions = NonNullable<
  Parameters<typeof buildVoiceSessionContext>[2]
>;

/** One key per call setup: same host, conversation, abilities and time zone. */
export function voiceContextKey(
  userId: string,
  memoryId: string | undefined,
  options: ContextOptions,
): string {
  const flags = [
    options.memoryTool && 'm',
    options.callActions && 'a',
    options.serverTools && 's',
    options.screenControl && 'c',
    options.screenFields && 'f',
  ]
    .filter(Boolean)
    .join('');
  return `voice-ctx:${userId}:${memoryId ?? '-'}:${flags}:${options.timeZone ?? '-'}`;
}

/**
 * The call context for a token. A reconnect (it carries a resume handle)
 * reuses the context its call started with instead of reading everything
 * again: faster when the network is already struggling, and the resumed
 * session keeps exactly the instructions it had. A new call always builds
 * afresh and stores what it built.
 */
export async function voiceSessionContextFor(
  user: HydratedDocument<IUser>,
  memoryId: string | undefined,
  options: ContextOptions & {resuming?: boolean},
  build: typeof buildVoiceSessionContext = buildVoiceSessionContext,
): Promise<VoiceSessionContext & {reused: boolean}> {
  const {resuming, ...buildOptions} = options;
  const key = voiceContextKey(String(user._id), memoryId, buildOptions);
  if (resuming) {
    const hit = await getCachedJson<VoiceSessionContext>(key).catch(() => null);
    if (hit?.systemInstruction) return {...hit, reused: true};
  }
  const context = await build(user, memoryId, buildOptions);
  setCachedJson(key, context, VOICE_CONTEXT_REUSE_SECONDS).catch(() => {});
  return {...context, reused: false};
}
