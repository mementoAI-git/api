import dayjs from 'dayjs';
import Memory from '../../../database/model/memory';
import Message from '../../../database/model/message';
import * as supermemory from '../../../../services/supermemory';
import {withTimeout} from './with-timeout';

const MAX_QUERY_CHARS = 200;
const MAX_RESULT_CHARS = 1_500;
const MAX_STORED_MATCHES = 5;
const MAX_CANDIDATES = 40;
const MAX_SUMMARY_CHARS = 200;
const EXCERPT_CHARS = 160;
const DEFAULT_LONG_TERM_TIMEOUT_MS = 2_500;
const MAX_CONVERSATION_MATCHES = 3;
const MAX_MESSAGE_CANDIDATES = 60;
/** Conversations to search, newest first. */
const MAX_CONVERSATIONS = 2_000;
/** A conversation search slower than this is skipped, not waited on. */
const CONVERSATION_SEARCH_MAX_MS = 1_500;

export const NO_MEMORY_MATCH_RESULT =
  'No matching memories found. Say you do not have that saved, and ask the host to tell you about it.';

export const MEMORY_SEARCH_UNAVAILABLE_RESULT =
  'Memory search is unavailable right now. Continue the conversation without it, and do not tell the host they have nothing saved.';

// Words that appear in almost any question and would otherwise match almost
// every memory, leaving recency to decide the "best" result.
const FILLER_WORDS = new Set([
  'the',
  'and',
  'about',
  'what',
  'when',
  'where',
  'who',
  'why',
  'how',
  'with',
  'that',
  'this',
  'these',
  'those',
  'was',
  'were',
  'did',
  'does',
  'have',
  'has',
  'had',
  'you',
  'your',
  'yours',
  'mine',
  'for',
  'from',
  'are',
  'not',
  'but',
  'her',
  'his',
  'she',
  'him',
  'they',
  'them',
  'their',
  'our',
  'ours',
  'tell',
  'remember',
  'know',
  'something',
  'anything',
  'any',
  'some',
  'there',
  'then',
  'than',
  'just',
  'like',
  'really',
  'very',
  'can',
  'could',
  'would',
  'should',
  'will',
  'into',
  'onto',
  'also',
  'been',
  'being',
  'its',
  'said',
  'say',
  'told',
  'talk',
  'talked',
  'again',
  'time',
  'times',
  'thing',
  'things',
  'one',
]);

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{N}'+-]/gu, ''))
    .filter(word => word.length >= 3 && !FILLER_WORDS.has(word))
    .slice(0, 6);
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short quote of the host's own words around the first matching word. */
function excerptAround(text: string, words: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(
    ...words.map(word => lower.indexOf(word)).filter(index => index >= 0),
  );
  if (!Number.isFinite(at)) return '';
  const start = Math.max(0, at - EXCERPT_CHARS / 2);
  const slice = text.slice(start, start + EXCERPT_CHARS).trim();
  return `${start > 0 ? '…' : ''}${slice}${start + EXCERPT_CHARS < text.length ? '…' : ''}`;
}

type Candidate = {
  title?: string;
  summary?: string;
  body?: string;
  topics?: string[];
  created_at?: Date | string;
  updated_at?: Date | string;
};

/** Distinct query words matched, weighted: title > topics = own words > summary. */
function relevance(row: Candidate, words: string[]): number {
  const title = String(row.title || '').toLowerCase();
  const topics = (row.topics || []).join(' ').toLowerCase();
  const body = stripHtml(String(row.body || '')).toLowerCase();
  const summary = String(row.summary || '').toLowerCase();
  let score = 0;
  for (const word of words) {
    if (title.includes(word)) score += 3;
    if (topics.includes(word)) score += 2;
    if (body.includes(word)) score += 2;
    if (summary.includes(word)) score += 1;
  }
  return score;
}

async function searchStoredMemories(
  userId: string,
  query: string,
): Promise<string[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const pattern = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows: Candidate[] = await Memory.find({
    user: userId,
    status: {$nin: ['draft', 'deleted']},
    $or: [
      {title: pattern},
      {summary: pattern},
      {topics: pattern},
      {body: pattern},
    ],
  })
    .sort({updated_at: -1})
    .limit(MAX_CANDIDATES)
    .select('title summary body topics created_at updated_at')
    .lean();

  return rows
    .map(row => ({row, score: relevance(row, words)}))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_STORED_MATCHES)
    .map(({row}) => {
      // When it was saved; the memory may describe a much earlier time.
      const saved = row.created_at
        ? ` (saved ${dayjs(row.created_at).format('MMMM YYYY')})`
        : '';
      const quote = excerptAround(stripHtml(String(row.body || '')), words);
      const summary = String(row.summary || '').slice(0, MAX_SUMMARY_CHARS);
      return [
        `- ${row.title || 'Untitled'}${saved}`,
        quote ? `  In their words: "${quote}"` : '',
        summary ? `  Summary: ${summary}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    });
}

/**
 * Backs the Gemini Live `search_memories` tool. Returns plain text the model
 * can speak from. Never throws for search failures.
 */
/**
 * What the host said in earlier chats and voice calls, in their own words.
 * Reached through the host's own conversations, which keeps the search on
 * the memory index and scoped to them. Memento's lines are left out: the
 * host's words are the record.
 */
async function searchConversations(
  userId: string,
  query: string,
): Promise<string[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const conversations = await Memory.find({
    user: userId,
    status: {$ne: 'deleted'},
  })
    .sort({updated_at: -1})
    .limit(MAX_CONVERSATIONS)
    .select('_id')
    .maxTimeMS(CONVERSATION_SEARCH_MAX_MS)
    .lean();
  if (!conversations.length) return [];

  const pattern = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows = await Message.find({
    memory: {$in: conversations.map(row => String(row._id))},
    role: 'user',
    text: pattern,
  })
    .sort({created_at: -1})
    .limit(MAX_MESSAGE_CANDIDATES)
    .select('text is_voice created_at')
    .maxTimeMS(CONVERSATION_SEARCH_MAX_MS)
    .lean();

  return rows
    .map(row => {
      const text = String(row.text || '').toLowerCase();
      return {row, score: words.filter(word => text.includes(word)).length};
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONVERSATION_MATCHES)
    .map(({row}) => {
      const where = row.is_voice ? 'In a voice call' : 'In a chat';
      const when = row.created_at
        ? ` (${dayjs(row.created_at).format('MMMM YYYY')})`
        : '';
      const quote = excerptAround(String(row.text || ''), words);
      return `- ${where}${when}: "${quote}"`;
    });
}

export async function searchMemoriesForVoice(
  userId: string,
  query: string,
  options: {longTermTimeoutMs?: number} = {},
): Promise<string> {
  const trimmed = query.trim().slice(0, MAX_QUERY_CHARS);
  const [stored, said, longTerm] = await Promise.all([
    searchStoredMemories(userId, trimmed).catch(() => null),
    searchConversations(userId, trimmed).catch(() => []),
    withTimeout(
      supermemory
        .getContextForUser(userId, trimmed)
        .then(result => result?.formatedText || ''),
      options.longTermTimeoutMs ?? DEFAULT_LONG_TERM_TIMEOUT_MS,
      '',
    ),
  ]);

  const sections: string[] = [];
  if (stored?.length) {
    sections.push(
      `Matching memories (dates are when each was saved, not when it happened):\n${stored.join('\n')}`,
    );
  }
  if (said.length) {
    sections.push(
      `From past conversations (their own words):\n${said.join('\n')}`,
    );
  }
  if (longTerm.trim()) sections.push(`Related facts:\n${longTerm.trim()}`);
  const result = sections.join('\n\n').slice(0, MAX_RESULT_CHARS);
  if (result) return result;
  // The saved-memory search itself failed: that is not the same as nothing
  // being saved, and Memento must not say so.
  return stored === null
    ? MEMORY_SEARCH_UNAVAILABLE_RESULT
    : NO_MEMORY_MATCH_RESULT;
}
