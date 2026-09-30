import dayjs from 'dayjs';
import Memory from '../../../database/model/memory';
import * as supermemory from '../../../../services/supermemory';
import {withTimeout} from './with-timeout';

const MAX_QUERY_CHARS = 200;
const MAX_RESULT_CHARS = 1_500;
const MAX_STORED_MATCHES = 5;
const MAX_SUMMARY_CHARS = 280;
const DEFAULT_LONG_TERM_TIMEOUT_MS = 2_500;

export const NO_MEMORY_MATCH_RESULT =
  'No matching memories found. Say you do not have that saved, and ask the host to tell you about it.';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(word => word.length >= 3)
    .slice(0, 6);
}

async function searchStoredMemories(
  userId: string,
  query: string,
): Promise<string[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const pattern = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows = await Memory.find({
    user: userId,
    status: {$nin: ['draft', 'deleted']},
    $or: [{title: pattern}, {summary: pattern}, {topics: pattern}],
  })
    .sort({updated_at: -1})
    .limit(MAX_STORED_MATCHES)
    .select('title summary created_at')
    .lean();

  return rows.map(row => {
    const when = row.created_at
      ? ` (${dayjs(row.created_at).format('MMMM YYYY')})`
      : '';
    const summary = String(row.summary || '').slice(0, MAX_SUMMARY_CHARS);
    return `- ${row.title || 'Untitled'}${when}${summary ? `: ${summary}` : ''}`;
  });
}

/**
 * Backs the Gemini Live `search_memories` tool. Returns plain text the model
 * can speak from. Never throws for search failures.
 */
export async function searchMemoriesForVoice(
  userId: string,
  query: string,
  options: {longTermTimeoutMs?: number} = {},
): Promise<string> {
  const trimmed = query.trim().slice(0, MAX_QUERY_CHARS);
  const [stored, longTerm] = await Promise.all([
    searchStoredMemories(userId, trimmed).catch(() => [] as string[]),
    withTimeout(
      supermemory
        .getContextForUser(userId, trimmed)
        .then(result => result?.formatedText || ''),
      options.longTermTimeoutMs ?? DEFAULT_LONG_TERM_TIMEOUT_MS,
      '',
    ),
  ]);

  const sections: string[] = [];
  if (stored.length) sections.push(`Matching memories:\n${stored.join('\n')}`);
  if (longTerm.trim()) sections.push(`Related facts:\n${longTerm.trim()}`);
  const result = sections.join('\n\n').slice(0, MAX_RESULT_CHARS);
  return result || NO_MEMORY_MATCH_RESULT;
}
