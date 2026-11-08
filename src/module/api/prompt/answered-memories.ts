import Memory from '../../database/model/memory';
import Message from '../../database/model/message';

/**
 * A prompt only counts as answered when a live memory linked to it holds an
 * answer: body text, an attachment, or a message the host wrote. Empty shells
 * (drafts made by opening a topic, conversations started but never replied to,
 * deleted or purge-pending stories) never move a question to "Answered".
 */

type AnswerCandidate = {
  _id: unknown;
  body?: string | null;
  attachments?: unknown[] | null;
};

/** Memory fields shared by every "answered" lookup. */
export function liveAnswerFilter(userId: string) {
  return {
    user: userId,
    status: {$nin: ['draft', 'deleted']},
    purge_requested_at: null,
  };
}

/** True when stored story HTML has readable text, not just empty tags. */
export function hasAnswerText(body?: string | null): boolean {
  if (!body) return false;
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
  return text.length > 0;
}

export function memoryHasAnswer(
  memory: AnswerCandidate,
  memoriesWithHostMessages: ReadonlySet<string>,
): boolean {
  return (
    hasAnswerText(memory.body) ||
    Boolean(memory.attachments?.length) ||
    memoriesWithHostMessages.has(String(memory._id))
  );
}

/** Ids of the given memories that have at least one host message with content. */
async function memoriesWithHostMessages(
  memories: AnswerCandidate[],
): Promise<Set<string>> {
  const ids = memories
    .filter(m => !hasAnswerText(m.body) && !m.attachments?.length)
    .map(m => String(m._id));
  if (!ids.length) return new Set();
  const found = await Message.distinct('memory', {
    memory: {$in: ids},
    role: 'user',
    $or: [{text: {$regex: /\S/}}, {'attatchments.0': {$exists: true}}],
  });
  return new Set(found.map(String));
}

/** Keeps only the memories that actually hold an answer, in the given order. */
export async function keepAnsweredMemories<T extends AnswerCandidate>(
  memories: T[],
): Promise<T[]> {
  const withMessages = await memoriesWithHostMessages(memories);
  return memories.filter(memory => memoryHasAnswer(memory, withMessages));
}

/** Prompt ids the host has really answered. */
export async function getAnsweredPromptIds(userId: string): Promise<string[]> {
  const candidates = await Memory.find({
    ...liveAnswerFilter(userId),
    prompt: {$exists: true, $ne: null},
  })
    .select('prompt body attachments')
    .lean();
  const answered = await keepAnsweredMemories(candidates);
  return [
    ...new Set(
      answered.map(m => m.prompt?.toString()).filter(Boolean) as string[],
    ),
  ];
}

/** The newest memory holding the host's answer to a prompt, if any. */
export async function findAnsweredPromptMemoryId(
  userId: string,
  promptId: string,
): Promise<string | null> {
  const candidates = await Memory.find({
    ...liveAnswerFilter(userId),
    prompt: promptId,
  })
    .sort({updated_at: -1})
    .select('_id body attachments')
    .lean();
  const [answered] = await keepAnsweredMemories(candidates);
  return answered ? String(answered._id) : null;
}
