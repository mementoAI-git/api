import Memory from '../../../database/model/memory';
import {escapeRegex, searchWords} from './memory-search';

export type FoundStory = {
  _id: unknown;
  title?: string;
  tags?: string[];
};

/**
 * The host's saved story that best matches what they said ("my story about
 * Lagos"): title words count most, then summary and topics. Only their own
 * stories, never drafts or deleted ones.
 */
export async function findStory(
  userId: string,
  query: unknown,
): Promise<FoundStory | undefined> {
  const words = searchWords(String(query ?? ''));
  if (!words.length) return undefined;
  const pattern = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows = await Memory.find({
    user: userId,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
    $or: [{title: pattern}, {summary: pattern}, {topics: pattern}],
  })
    .sort({updated_at: -1})
    .limit(20)
    .select('title summary topics tags')
    .lean();
  return rows
    .map(row => {
      const title = String(row.title || '').toLowerCase();
      const rest =
        `${row.summary || ''} ${(row.topics || []).join(' ')}`.toLowerCase();
      const score = words.reduce(
        (sum, word) =>
          sum + (title.includes(word) ? 3 : 0) + (rest.includes(word) ? 1 : 0),
        0,
      );
      return {row, score};
    })
    .sort((a, b) => b.score - a.score)[0]?.row as FoundStory | undefined;
}
