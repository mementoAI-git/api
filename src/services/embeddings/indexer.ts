import Memory from '../../module/database/model/memory';
import MemoryEmbedding, {
  type EmbeddingSource,
} from '../../module/database/model/memory-embedding';
import Message from '../../module/database/model/message';
import {stripHtml} from '../../module/api/ai/voice/memory-search';
import {EMBEDDING_MODEL, embed, pack, textHash} from '.';
import {forgetCachedVectors} from './search';

/**
 * Keeps embeddings in step with what the host writes and says:
 * - saved stories (title and body, long ones in pieces), re-embedded only
 *   when their text changes, removed when deleted or back to draft;
 * - the host's own lines in chats and voice calls (Memento's lines are not
 *   indexed: the host's words are the record).
 *
 * Runs on a schedule over recent changes (runEmbeddingSweep) and once over
 * everything (the backfill script). Idempotent: rerunning changes nothing.
 */

const CHUNK_CHARS = 1_500;
const MAX_CHUNKS = 6;
const MIN_MESSAGE_CHARS = 20;
const QUOTE_CHARS = 400;
/** Most items embedded in one sweep, to bound cost if a backlog builds up. */
const SWEEP_LIMIT = 400;

type Item = {
  user: string;
  source: EmbeddingSource;
  source_id: string;
  chunk: number;
  memory?: string;
  text: string;
  written_at?: Date;
};

function storyChunks(title: string, body: string): string[] {
  const text = [title.trim(), stripHtml(body)].filter(Boolean).join('\n');
  if (!text) return [];
  const chunks: string[] = [];
  for (
    let start = 0;
    start < text.length && chunks.length < MAX_CHUNKS;
    start += CHUNK_CHARS
  ) {
    chunks.push(text.slice(start, start + CHUNK_CHARS));
  }
  return chunks;
}

/** Embeds the items whose text is new or changed. Returns how many were embedded. */
async function upsert(items: Item[]): Promise<number> {
  if (!items.length) return 0;
  const existing = await MemoryEmbedding.find({
    $or: items.map(item => ({
      source: item.source,
      source_id: item.source_id,
      chunk: item.chunk,
    })),
  })
    .select('source source_id chunk text_hash')
    .lean();
  const known = new Map(
    existing.map(row => [
      `${row.source}:${row.source_id}:${row.chunk}`,
      row.text_hash,
    ]),
  );
  const changed = items.filter(
    item =>
      known.get(`${item.source}:${item.source_id}:${item.chunk}`) !==
      textHash(item.text),
  );
  if (!changed.length) return 0;

  const vectors = await embed(
    changed.map(item => item.text),
    'RETRIEVAL_DOCUMENT',
  );
  await MemoryEmbedding.bulkWrite(
    changed.map((item, index) => ({
      updateOne: {
        filter: {
          source: item.source,
          source_id: item.source_id,
          chunk: item.chunk,
        },
        update: {
          $set: {
            user: item.user,
            memory: item.memory,
            text: item.text.slice(0, QUOTE_CHARS),
            text_hash: textHash(item.text),
            vector: pack(vectors[index]),
            embedding_model: EMBEDDING_MODEL,
            written_at: item.written_at,
          },
        },
        upsert: true,
      },
    })),
  );
  for (const user of new Set(changed.map(item => item.user)))
    forgetCachedVectors(user);
  return changed.length;
}

/** Stories changed since `since` (or all, for the backfill), in order. */
export async function indexStories(
  options: {since?: Date; user?: string; limit?: number} = {},
): Promise<number> {
  const filter: Record<string, unknown> = {type: 'story'};
  if (options.since) filter.updated_at = {$gte: options.since};
  if (options.user) filter.user = options.user;
  const stories = await Memory.find(filter)
    .sort({updated_at: 1})
    .limit(options.limit ?? SWEEP_LIMIT)
    .select('user title body status created_at')
    .lean();

  const items: Item[] = [];
  const removed: string[] = [];
  for (const story of stories) {
    const id = String(story._id);
    if (story.status === 'draft' || story.status === 'deleted') {
      removed.push(id);
      continue;
    }
    const chunks = storyChunks(
      String(story.title || ''),
      String(story.body || ''),
    );
    chunks.forEach((text, chunk) =>
      items.push({
        user: String(story.user),
        source: 'story',
        source_id: id,
        chunk,
        memory: id,
        text,
        written_at: story.created_at
          ? new Date(story.created_at as unknown as string)
          : undefined,
      }),
    );
    // A story that got shorter drops its trailing pieces.
    await MemoryEmbedding.deleteMany({
      source: 'story',
      source_id: id,
      chunk: {$gte: chunks.length},
    });
  }
  if (removed.length) {
    const gone = await MemoryEmbedding.find({
      source: 'story',
      source_id: {$in: removed},
    }).distinct('user');
    await MemoryEmbedding.deleteMany({
      source: 'story',
      source_id: {$in: removed},
    });
    for (const user of gone) forgetCachedVectors(String(user));
  }
  return upsert(items);
}

/** The host's own chat and voice lines written since `since` (or all). */
export async function indexMessages(
  options: {since?: Date; user?: string; limit?: number} = {},
): Promise<number> {
  const filter: Record<string, unknown> = {role: 'user'};
  if (options.since) filter.created_at = {$gte: options.since};
  if (options.user) filter.user = options.user;
  const messages = await Message.find(filter)
    .sort({created_at: 1})
    .limit(options.limit ?? SWEEP_LIMIT)
    .select('user memory text created_at')
    .lean();
  return upsert(
    messages
      .filter(
        message =>
          String(message.text || '').trim().length >= MIN_MESSAGE_CHARS,
      )
      .map(message => ({
        user: String(message.user),
        source: 'message' as const,
        source_id: String(message._id),
        chunk: 0,
        memory: message.memory ? String(message.memory) : undefined,
        text: String(message.text).trim(),
        written_at: message.created_at
          ? new Date(message.created_at as unknown as string)
          : undefined,
      })),
  );
}

/** Embeddings whose story or message no longer exists (hard deletes). */
export async function pruneOrphans(batch = 1_000): Promise<number> {
  let removed = 0;
  for (const source of ['story', 'message'] as const) {
    const ids = await MemoryEmbedding.find({source}).distinct('source_id');
    for (let start = 0; start < ids.length; start += batch) {
      const slice = ids.slice(start, start + batch);
      const alive = new Set(
        (source === 'story'
          ? await Memory.find({
              _id: {$in: slice},
              status: {$nin: ['deleted', 'draft']},
            }).distinct('_id')
          : await Message.find({_id: {$in: slice}}).distinct('_id')
        ).map(String),
      );
      const dead = slice.filter(id => !alive.has(String(id)));
      if (dead.length) {
        const result = await MemoryEmbedding.deleteMany({
          source,
          source_id: {$in: dead},
        });
        removed += result.deletedCount ?? 0;
      }
    }
  }
  return removed;
}

/** One scheduled pass over recent changes. */
export async function runEmbeddingSweep(
  now = new Date(),
  windowMs = 20 * 60_000,
) {
  const since = new Date(now.getTime() - windowMs);
  const stories = await indexStories({since});
  const messages = await indexMessages({since});
  return {stories, messages};
}
