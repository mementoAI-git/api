import Memory from '../../module/database/model/memory';
import {loadChatSources} from './chats';
import {searchPilotEnabled} from './config';
import {embedQuery} from './engine';
import {loadSearchPhotos, ownerSearchScope} from './load';
import {
  MAX_PILOT_MEMORIES,
  cosine,
  hasFreshIndex,
  idOf,
  plainText,
  rankMemories,
  textChunks,
  type SearchMemory,
  type SearchPhoto,
} from './source';

/**
 * Recall for voice and chat from the description-search index (EmbeddingGemma
 * on the embedding server): multilingual, and the same index the search
 * window uses, so there is one meaning index of the host's own words. Only
 * for owners in the description-search pilot whose index is ready; returns
 * null otherwise so the caller can use its fallback.
 */

export type DescriptionRecall = {
  source: 'story' | 'conversation';
  memory: string;
  title: string;
  text: string;
  written_at?: Date;
  score: number;
};

const CACHE_MS = 2 * 60_000;
const MAX_CACHED_USERS = 200;
const EXCERPT_CHARS = 320;

type Collection = {at: number; memories: SearchMemory[]; files: SearchPhoto[]};
const cache = new Map<string, Collection>();

/** Drop a host's cached collection after their stories or chats change. */
export function forgetRecallCollection(userId: string): void {
  cache.delete(String(userId));
}

async function collectionFor(userId: string): Promise<Collection | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const saved = await Memory.find(ownerSearchScope(userId))
    .select('+search_index')
    .sort({created_at: -1})
    .limit(MAX_PILOT_MEMORIES + 1)
    .lean();
  if (saved.length > MAX_PILOT_MEMORIES) return null;
  const memories = await loadChatSources(userId, saved as SearchMemory[]);
  const files = (await loadSearchPhotos(userId, memories)) as SearchPhoto[];
  const collection = {at: Date.now(), memories, files};
  if (cache.size >= MAX_CACHED_USERS) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(userId, collection);
  return collection;
}

/** The text of a memory's best-matching chunk, as the index cut it. */
function bestExcerpt(memory: SearchMemory, vector: number[]): string {
  const chunks = textChunks(
    memory.title,
    [memory.body, memory.chat_source?.text].filter(Boolean).join('\n'),
  );
  const vectors = memory.search_index?.chunks ?? [];
  let best = 0;
  let bestScore = -Infinity;
  // Text chunks come first in the index, in the order textChunks cuts them.
  for (let i = 0; i < Math.min(chunks.length, vectors.length); i += 1) {
    if (vectors[i].kind !== 'story') continue;
    const score = cosine(vector, vectors[i].vector);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  const chunk = chunks[best] ?? '';
  const text = chunk.replace(/^title: .*? \| text: /, '');
  return plainText(text).slice(0, EXCERPT_CHARS);
}

export async function recallWithDescriptions(
  userId: string,
  topic: string,
  options: {limit?: number} = {},
): Promise<DescriptionRecall[] | null> {
  const id = String(userId);
  if (!topic.trim() || !searchPilotEnabled(id)) return null;
  const collection = await collectionFor(id);
  if (!collection) return null;
  const {memories, files} = collection;
  const indexed = memories.filter(memory => hasFreshIndex(memory, files));
  if (!indexed.length) return null;
  let vector: number[];
  try {
    vector = await embedQuery(topic);
  } catch {
    return null;
  }
  const byId = new Map(indexed.map(memory => [idOf(memory), memory]));
  return rankMemories(indexed, files, topic, vector)
    .slice(0, options.limit ?? 4)
    .flatMap(row => {
      const memory = byId.get(row.id);
      if (!memory) return [];
      return [
        {
          source:
            memory.type === 'conversation'
              ? ('conversation' as const)
              : ('story' as const),
          memory: row.id,
          title: String(memory.title || ''),
          text: bestExcerpt(memory, vector),
          written_at: (memory as {created_at?: Date}).created_at,
          score: row.score,
        },
      ];
    });
}
