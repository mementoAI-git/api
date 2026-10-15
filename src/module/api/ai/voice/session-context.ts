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

const DEFAULT_LONG_TERM_TIMEOUT_MS = 1_500;
const HOST_OVERVIEW_TIMEOUT_MS = 1_500;
const MAX_TRANSCRIPT_LINES = 20;
const MAX_NOTES_CHARS = 400;

export type VoiceSessionContext = {
  systemInstruction: string;
  greetingInstruction: string;
  memoryId?: string;
};

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
    timeZone?: string;
    timer?: StepTimer;
  } = {},
): Promise<VoiceSessionContext> {
  const userId = String(user._id);
  const time = <T>(name: string, work: () => Promise<T>) =>
    options.timer ? options.timer.time(`context.${name}`, work) : work();

  // Unowned, malformed or stale IDs must never block a call or leak another
  // user's data. Promise.resolve().then() also catches synchronous throws.
  const memory = memoryId
    ? await time('memory', () =>
        Promise.resolve()
          .then(() => findOwnedMemory(memoryId, userId))
          .catch(() => null),
      )
    : null;
  const ownedMemoryId = memory ? String(memory._id) : undefined;

  const reflectionTopic =
    String(memory?.prompt_text || '').trim() ||
    (memory?.type === 'story' ? String(memory?.title || '').trim() : '') ||
    undefined;
  const memoryNotes =
    memory?.type === 'story'
      ? stripHtml(String(memory?.body || '')).slice(0, MAX_NOTES_CHARS) ||
        undefined
      : undefined;

  const linesReady = ownedMemoryId
    ? time('lines', () =>
        getRecentConversationLines(userId, ownedMemoryId, MAX_TRANSCRIPT_LINES),
      )
    : Promise.resolve([]);
  // What to recall at the start: the reflection, else what the host last
  // said in this conversation. Without either there is nothing specific to
  // look up, and the host overview and profile already cover the basics.
  const longTermReady = linesReady.then(recent => {
    const lastHostLine = [...recent]
      .reverse()
      .find(line => line.speaker === 'Host')?.text;
    const topic =
      reflectionTopic ||
      lastHostLine ||
      (MEMORY_RETRIEVAL === 'supermemory'
        ? 'ongoing life, recent conversations and people'
        : '');
    return time('recall', () =>
      getLongTermContext(userId, topic).catch(() => ''),
    );
  });
  const [lines, longTermContext, hostOverview] = await Promise.all([
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
  ]);

  const hostTurns = lines.filter(line => line.speaker === 'Host').length;
  let baseContext = '';
  try {
    baseContext = await time('base', () =>
      prompts.createSystemContext(
        user,
        ownedMemoryId,
        null,
        longTermContext,
        hostTurns,
      ),
    );
  } catch (error) {
    console.error('Failed to build base system context for voice mode:', error);
  }

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
    }),
    greetingInstruction: buildVoiceGreetingInstruction({
      name: name || undefined,
      hasRecentTurns: lines.length > 0,
      reflectionTopic,
    }),
    memoryId: ownedMemoryId,
  };
}
