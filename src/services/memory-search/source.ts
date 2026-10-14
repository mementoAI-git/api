import {createHash} from 'node:crypto';
import type {
  IMemory,
  IMemorySearchIndex,
} from '../../module/database/model/memory';
import {EXCLUDED_STORAGE_PROVIDER} from '../../utils/constant';
import {photoSearchEnabled} from './config';

export const VECTOR_VERSION =
  'embeddinggemma2-bfcd298-llamacpp-v1-q8-text1800-photo140';
export const MAX_PILOT_MEMORIES = 200;
export type SearchMemory = Pick<
  IMemory,
  'user' | 'type' | 'status' | 'title' | 'body' | 'attachments' | 'tags'
> & {
  _id?: unknown;
  search_index?: IMemorySearchIndex;
  /** Request/worker-local app transcript; never persisted or serialized. */
  chat_source?: {revision: string; text: string; complete: boolean};
};
export type SearchPhoto = {
  _id?: unknown;
  user: string;
  name: string;
  type: string;
  size: number;
  provider?: string;
  deleted?: boolean;
  status?: string;
  updated_at?: unknown;
};

export function idOf(value: unknown): string {
  if (value && typeof value === 'object' && '_id' in value)
    return String(value._id);
  return String(value);
}

export function photosFor(
  memory: SearchMemory,
  files: SearchPhoto[],
): SearchPhoto[] {
  if (!photoSearchEnabled()) return [];
  const ids = new Set((memory.attachments || []).map(idOf));
  return files.filter(
    file =>
      ids.has(idOf(file)) &&
      String(file.user) === String(memory.user) &&
      !file.deleted &&
      file.provider !== EXCLUDED_STORAGE_PROVIDER &&
      !['processing', 'failed'].includes(file.status) &&
      /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type),
  );
}

export function fingerprint(
  memory: SearchMemory,
  files: SearchPhoto[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        user: String(memory.user),
        type: memory.type,
        status: memory.status,
        title: memory.title || '',
        body: memory.body || '',
        tags: memory.tags || [],
        attachments: (memory.attachments || []).map(idOf).sort(),
        ...(photoSearchEnabled() ? {} : {photo_search: 'disabled'}),
        ...(memory.type === 'conversation'
          ? {chat: memory.chat_source?.revision || 'unloaded'}
          : {}),
        photos: photosFor(memory, files)
          .map(file => ({
            id: idOf(file),
            name: file.name,
            type: file.type,
            size: file.size,
            provider: file.provider,
            updated_at: file.updated_at,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
}

export function plainText(html = ''): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function textChunks(title = '', body = ''): string[] {
  const text = plainText(body);
  if (text.length > 1800 * 128)
    throw new Error('Story is too large for the description-search pilot');
  if (!title.trim() && !text) return [];
  const chunks: string[] = [];
  for (let offset = 0; offset < Math.max(1, text.length); offset += 1600) {
    chunks.push(
      `title: ${plainText(title).slice(0, 160) || 'none'} | text: ${text.slice(offset, offset + 1800)}`,
    );
  }
  return chunks;
}

export function hasFreshIndex(
  memory: SearchMemory,
  files: SearchPhoto[],
): boolean {
  return (
    ['story', 'conversation'].includes(memory.type) &&
    (memory.type !== 'conversation' || memory.chat_source?.complete === true) &&
    !['draft', 'deleted'].includes(memory.status) &&
    memory.search_index?.version === VECTOR_VERSION &&
    !memory.search_index.retry_after &&
    memory.search_index.fingerprint === fingerprint(memory, files)
  );
}

export function isCoolingDown(
  memory: SearchMemory,
  files: SearchPhoto[],
): boolean {
  return (
    memory.search_index?.version === VECTOR_VERSION &&
    memory.search_index.fingerprint === fingerprint(memory, files) &&
    new Date(memory.search_index.retry_after || 0).getTime() > Date.now()
  );
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const score = dot / Math.sqrt(aa * bb);
  return Number.isFinite(score) ? score : 0;
}

export function rankMemories(
  memories: SearchMemory[],
  files: SearchPhoto[],
  query: string,
  vector?: number[],
) {
  const stop = new Set([
    'the',
    'and',
    'our',
    'was',
    'for',
    'find',
    'with',
    'about',
    'where',
    'show',
    'when',
    'that',
    'how',
    'did',
    'got',
    'from',
    'this',
    'you',
    'your',
    'tell',
  ]);
  const words = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []),
  ].filter(word => !stop.has(word));
  const similarities = new Map<string, {kind: string; score: number}[]>();
  if (vector) {
    for (const memory of memories) {
      if (hasFreshIndex(memory, files))
        similarities.set(
          idOf(memory),
          memory.search_index.chunks.map(chunk => ({
            kind: chunk.kind,
            score: cosine(vector, chunk.vector),
          })),
        );
    }
  }
  // Like DigUp, require a result to stand out from the user's collection;
  // an absolute similarity alone can return a vaguely related but wrong memory.
  const pool = [...similarities.values()].flat();
  const average = (values: number[]) =>
    values.reduce((sum, score) => sum + score, 0) / Math.max(1, values.length);
  const allMean = average(pool.map(row => row.score));
  const groups = new Map<string, {sum: number; count: number}>();
  for (const row of pool) {
    const group = groups.get(row.kind) || {sum: 0, count: 0};
    group.sum += row.score;
    group.count++;
    groups.set(row.kind, group);
  }
  const centered = (row: {kind: string; score: number}) => {
    const group = groups.get(row.kind);
    return row.score - (group.count >= 20 ? group.sum / group.count : allMean);
  };
  const centerMean = average(pool.map(centered));
  const deviation = Math.max(
    0.02,
    Math.sqrt(average(pool.map(row => (centered(row) - centerMean) ** 2))),
  );
  return memories
    .filter(memory => !['draft', 'deleted'].includes(memory.status))
    .map(memory => {
      const title = (memory.title || '').toLowerCase();
      const body = plainText(
        [
          memory.body,
          memory.chat_source?.complete ? memory.chat_source.text : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ).toLowerCase();
      const tags = (memory.tags || []).join(' ').toLowerCase();
      const lexical = words.reduce(
        (sum, word) =>
          sum +
          (title.includes(word) ? 3 : 0) +
          (tags.includes(word) ? 2 : 0) +
          (body.includes(word) ? 1 : 0),
        0,
      );
      const matchedWords = words.filter(
        word =>
          title.includes(word) || tags.includes(word) || body.includes(word),
      ).length;
      const exact =
        query.trim().length > 1 &&
        [title, tags, body].some(text =>
          text.includes(query.trim().toLowerCase()),
        );
      const wordMatch =
        exact ||
        (words.length > 0 && matchedWords >= Math.ceil(words.length * 0.6));
      let semantic = 0;
      for (const row of similarities.get(idOf(memory)) || []) {
        const z = (centered(row) - centerMean) / deviation;
        const strong = pool.length < 6 ? row.score >= 0.75 : z >= 2;
        if (strong && row.score >= (row.kind === 'photo' ? 0.6 : 0.65))
          semantic = Math.max(
            semantic,
            pool.length < 6 ? row.score : Math.min(1, z / 4),
          );
      }
      return {
        id: idOf(memory),
        score:
          (wordMatch
            ? (exact ? 1 : 0) +
              Math.min(0.2, (lexical / Math.max(1, words.length * 6)) * 0.2)
            : 0) + semantic,
        semantic: semantic > 0,
      };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
