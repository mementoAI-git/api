import MemoryEmbedding, {
  type EmbeddingSource,
} from '../../module/database/model/memory-embedding';
import {embed, pack, similarity} from '.';

/**
 * Finds what the host wrote or said that is closest in meaning to a
 * question ("what did I say about my brother moving abroad?" finds the
 * story about Emeka's visa). Compares in the API: one user's vectors are
 * small (hundreds to a few thousand), cached for a few minutes, so this
 * works on the Atlas free tier with no search index. Only ever the host's
 * own content.
 */

const CACHE_MS = 5 * 60_000;
const MAX_CACHED_USERS = 200;
/** Below this, a match is noise. */
const MIN_SCORE = 0.5;
/** Matches far below the best one are dropped. */
const MAX_GAP = 0.12;

type Cached = {
  at: number;
  items: {
    source: EmbeddingSource;
    source_id: string;
    memory?: string;
    text: string;
    written_at?: Date;
    vector: Buffer;
  }[];
};

const cache = new Map<string, Cached>();

/** Lean queries return BSON Binary for Buffer fields. */
function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  const binary = value as {buffer?: ArrayBuffer | Uint8Array};
  return Buffer.from((binary?.buffer ?? new Uint8Array()) as Uint8Array);
}

/** Drop a user's cached vectors after their content changes. */
export function forgetCachedVectors(user: string): void {
  cache.delete(user);
}

async function vectorsFor(user: string): Promise<Cached['items']> {
  const hit = cache.get(user);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const rows = await MemoryEmbedding.find({user})
    .select('source source_id memory text written_at vector')
    .lean();
  const items = rows.map(row => ({
    source: row.source,
    source_id: row.source_id,
    memory: row.memory,
    text: row.text,
    written_at: row.written_at,
    vector: toBuffer(row.vector),
  }));
  if (cache.size >= MAX_CACHED_USERS) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(user, {at: Date.now(), items});
  return items;
}

export type SemanticMatch = Cached['items'][number] & {score: number};

export async function semanticSearch(
  user: string,
  query: string,
  options: {limit?: number} = {},
): Promise<SemanticMatch[]> {
  const text = query.trim();
  if (!text) return [];
  const items = await vectorsFor(user);
  if (!items.length) return [];
  const [values] = await embed([text], 'RETRIEVAL_QUERY');
  const wanted = pack(values);
  const scored = items
    .map(item => ({...item, score: similarity(item.vector, wanted)}))
    .filter(item => item.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const best = scored[0].score;
  // One match per story or conversation: its best piece.
  const seen = new Set<string>();
  return scored
    .filter(item => best - item.score <= MAX_GAP)
    .filter(item => {
      const key = item.memory || `${item.source}:${item.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.limit ?? 5);
}
