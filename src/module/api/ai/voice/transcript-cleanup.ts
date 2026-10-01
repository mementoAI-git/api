import Message from '../../../database/model/message';
import VoiceCall, {
  VoiceCallCleanupStatus,
} from '../../../database/model/voice-call';
import {addToInsightsBuffer} from '../../../../services/queues/insights';
import {extractJson} from '../../../../utils/helpers';
import {isSignificantMessage} from '../utils';
import {generateVoiceJson} from './text-generator';

export const UNCLEAR_MARKER = '[unclear]';
const MAX_LINE_LENGTH = 8_000;
const STALE_RUNNING_MS = 2 * 60_000;
const WAIT_POLL_MS = 500;
const WAIT_MAX_MS = 20_000;

export type CallTurn = {
  id: string;
  index: number;
  role: 'user' | 'ai';
  text: string;
  raw_text?: string;
  memory: string;
};

export type CleanupFix = {index: number; text: string};

export async function loadCallTurns(
  userId: string,
  sessionId: string,
): Promise<CallTurn[]> {
  const messages = await Message.find({
    user: userId,
    voice_session_id: sessionId,
  })
    .sort({voice_turn_index: 1})
    .select('role text raw_text voice_turn_index memory')
    .lean();
  return messages.map(message => ({
    id: String(message._id),
    index: message.voice_turn_index ?? 0,
    role: message.role === 'user' ? 'user' : 'ai',
    text: message.text ?? '',
    raw_text: message.raw_text,
    memory: String(message.memory),
  }));
}

export function formatTranscriptLines(turns: CallTurn[]): string {
  return turns
    .map(
      turn =>
        `[${turn.index}] ${turn.role === 'user' ? 'Host' : 'Memento'}: ${turn.text}`,
    )
    .join('\n');
}

export function buildCleanupPrompt(turns: CallTurn[]): string {
  return `You are cleaning up the speech-to-text transcript of a voice call between a person (the Host) and Memento, a warm AI companion that helps them record their life stories. The call was in English.

The Host lines come from automatic speech recognition. It sometimes mishears words, and it sometimes writes unclear audio in the wrong language or script.

For each Host line, decide:
- If it is sensible English, leave it out of your answer.
- If it has obvious mishearings and the conversation around it, especially Memento's next reply, makes the intended English words clear, return the corrected line.
- If it is not in English, or is gibberish, and you cannot tell with confidence which English words were said, return "${UNCLEAR_MARKER}".

Rules:
- Only return Host lines. Never return or change Memento's lines.
- Keep the Host's own words. Do not summarize, add details, restyle, or fix grammar.
- Do not translate. A non-English line becomes "${UNCLEAR_MARKER}" unless Memento's reply shows exactly what was said in English.

Return JSON only, in this shape: {"fixes":[{"index":<line number>,"text":"<corrected line>"}]}
Return {"fixes":[]} if every Host line is fine.

Transcript:
${formatTranscriptLines(turns)}`;
}

/**
 * Parses the model's clean-up answer. Returns null when the answer is not
 * the expected shape. Fixes for unknown or non-Host lines are dropped.
 */
export function parseCleanupResponse(
  raw: string,
  userTurnIndexes: ReadonlySet<number>,
): CleanupFix[] | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fixes)) {
    return null;
  }
  const byIndex = new Map<number, string>();
  for (const fix of parsed.fixes as unknown[]) {
    if (!fix || typeof fix !== 'object') continue;
    const {index, text} = fix as {index?: unknown; text?: unknown};
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    if (!userTurnIndexes.has(index)) continue;
    if (typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_LINE_LENGTH) continue;
    byIndex.set(index, trimmed);
  }
  return [...byIndex].map(([index, text]) => ({index, text}));
}

async function claimCleanup(userId: string, sessionId: string) {
  return VoiceCall.findOneAndUpdate(
    {
      user: userId,
      session_id: sessionId,
      $or: [
        {cleanup_status: {$in: ['pending', 'failed']}},
        {
          cleanup_status: 'running',
          updated_at: {$lt: new Date(Date.now() - STALE_RUNNING_MS)},
        },
      ],
    },
    {$set: {cleanup_status: 'running'}},
    {new: true},
  );
}

async function setStatus(
  userId: string,
  sessionId: string,
  status: VoiceCallCleanupStatus,
  extra: Record<string, unknown> = {},
) {
  await VoiceCall.updateOne(
    {user: userId, session_id: sessionId},
    {$set: {cleanup_status: status, ...extra}},
  );
}

async function queueInsights(userId: string, turns: CallTurn[]) {
  for (let i = 0; i < turns.length - 1; i += 1) {
    const userTurn = turns[i];
    const reply = turns[i + 1];
    if (userTurn.role !== 'user' || reply.role !== 'ai') continue;
    if (reply.index !== userTurn.index + 1) continue;
    if (userTurn.text === UNCLEAR_MARKER) continue;
    if (!isSignificantMessage(userTurn.text)) continue;
    await addToInsightsBuffer(
      userId,
      userTurn.memory,
      userTurn.text,
      reply.text,
    ).catch(error => console.error('Error queueing voice insights:', error));
  }
}

/**
 * Cleans the Host lines of one voice call in place. Originals are kept in
 * raw_text. Safe to call more than once: only one run claims the call.
 * Returns the cleanup status after this call.
 */
export async function cleanVoiceCallTranscript(
  userId: string,
  sessionId: string,
): Promise<VoiceCallCleanupStatus | null> {
  const call = await claimCleanup(userId, sessionId);
  if (!call) {
    const current = await VoiceCall.findOne({
      user: userId,
      session_id: sessionId,
    })
      .select('cleanup_status')
      .lean();
    return current?.cleanup_status ?? null;
  }

  try {
    const turns = await loadCallTurns(userId, sessionId);
    const userIndexes = new Set(
      turns.filter(turn => turn.role === 'user').map(turn => turn.index),
    );
    if (userIndexes.size === 0) {
      await setStatus(userId, sessionId, 'skipped', {queue_insights: false});
      return 'skipped';
    }

    const raw = await generateVoiceJson(
      'voice_transcript_cleanup',
      buildCleanupPrompt(turns),
      userId,
      {accept: answer => parseCleanupResponse(answer, userIndexes) !== null},
    );
    const fixes = parseCleanupResponse(raw, userIndexes);
    if (!fixes) {
      console.error('Voice transcript clean-up returned an invalid answer', {
        sessionId,
      });
      await setStatus(userId, sessionId, 'failed');
      return 'failed';
    }

    for (const fix of fixes) {
      const turn = turns.find(t => t.index === fix.index);
      if (!turn || turn.text === fix.text) continue;
      await Message.updateOne(
        {_id: turn.id},
        {
          $set: {
            text: fix.text,
            raw_text: turn.raw_text ?? turn.text,
            voice_cleaned: true,
          },
        },
      );
      turn.text = fix.text;
    }

    await setStatus(userId, sessionId, 'done', {
      cleaned_at: new Date(),
      queue_insights: false,
    });
    if (call.queue_insights) await queueInsights(userId, turns);
    return 'done';
  } catch (error) {
    console.error('Voice transcript clean-up failed', {sessionId, error});
    await setStatus(userId, sessionId, 'failed').catch(() => undefined);
    return 'failed';
  }
}

/**
 * Makes sure clean-up has been attempted before the transcript is used.
 * Runs it when pending or failed, and waits briefly when another run holds it.
 */
export async function ensureVoiceCallCleaned(
  userId: string,
  sessionId: string,
): Promise<void> {
  const status = await cleanVoiceCallTranscript(userId, sessionId);
  if (status !== 'running') return;
  const deadline = Date.now() + WAIT_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, WAIT_POLL_MS));
    const current = await VoiceCall.findOne({
      user: userId,
      session_id: sessionId,
    })
      .select('cleanup_status')
      .lean();
    if (current?.cleanup_status !== 'running') return;
  }
}
