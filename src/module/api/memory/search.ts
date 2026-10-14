import Memory from '../../database/model/memory';
import Message from '../../database/model/message';
import {loadChatSources} from '../../../services/memory-search/chats';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import {searchPilotEnabled} from '../../../services/memory-search/config';
import {embedQuery} from '../../../services/memory-search/engine';
import {
  hasFreshIndex,
  isCoolingDown,
  fingerprint,
  idOf,
  MAX_PILOT_MEMORIES,
  rankMemories,
} from '../../../services/memory-search/source';
import {
  loadSearchPhotos,
  ownerSearchScope,
} from '../../../services/memory-search/load';
import {queueMemorySearch} from '../../../services/queues/memory-search';

function attachmentPopulate(userId: string) {
  return {
    path: 'attachments',
    match: {
      user: userId,
      deleted: {$ne: true},
      provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
    },
  };
}

async function keywordFallback(userId: string, query: string) {
  const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // Bound live conversations, rather than message rows that one busy or deleted
  // chat could monopolize. The lookup uses the existing Message.memory index.
  const chatMatches = await Memory.aggregate<{_id: unknown}>([
    {$match: {...ownerSearchScope(userId), type: 'conversation'}},
    {$sort: {created_at: -1, _id: 1}},
    {
      $lookup: {
        from: Message.collection.name,
        let: {chatId: {$toString: '$_id'}},
        pipeline: [
          {
            $match: {
              user: userId,
              text: literal,
              $expr: {$eq: ['$memory', '$$chatId']},
            },
          },
          {$limit: 1},
          {$project: {_id: 1}},
        ],
        as: 'matching_messages',
      },
    },
    {$match: {'matching_messages.0': {$exists: true}}},
    {$limit: 20},
    {$project: {_id: 1}},
  ]);
  const chatIds = chatMatches.map(memory => memory._id);
  const data = await Memory.paginate(
    {
      ...ownerSearchScope(userId),
      $or: [
        {title: literal},
        {body: literal},
        {tags: literal},
        {type: 'conversation', _id: {$in: chatIds}},
      ],
    },
    {
      page: 1,
      limit: 20,
      sort: {created_at: -1},
      populate: attachmentPopulate(userId),
    },
  );
  return {...data, search: {mode: 'keyword' as const, preparing: false}};
}

/** Owner-only pilot; every result is reloaded with current permissions and sources. */
export async function searchMemories(userId: string, query: string) {
  if (!searchPilotEnabled(userId) || query.trim().length < 3)
    return keywordFallback(userId, query);
  const saved = await Memory.find(ownerSearchScope(userId))
    .select('+search_index')
    .sort({created_at: -1})
    .limit(MAX_PILOT_MEMORIES + 1)
    .lean();
  if (saved.length > MAX_PILOT_MEMORIES) return keywordFallback(userId, query);
  const memories = await loadChatSources(userId, saved);
  if (
    memories.some(
      memory => memory.type === 'conversation' && !memory.chat_source?.complete,
    )
  ) {
    const data = await keywordFallback(userId, query);
    return {...data, search: {...data.search, limited: true}};
  }
  const files = await loadSearchPhotos(userId, memories);
  const stale = memories.filter(
    memory =>
      (memory.type !== 'conversation' || memory.chat_source?.complete) &&
      !hasFreshIndex(memory, files) &&
      !isCoolingDown(memory, files),
  );
  // Bounded lazy backfill; the UI polls while work is queued. Fresh writes also queue preparation.
  const scheduled = await Promise.all(
    stale.slice(0, 10).map(memory => queueMemorySearch(userId, idOf(memory))),
  );
  const preparing = scheduled.some(Boolean);
  let vector: number[] | undefined;
  if (memories.some(memory => hasFreshIndex(memory, files))) {
    try {
      vector = await embedQuery(query);
    } catch {
      /* Word matches remain available. */
    }
  }
  const ranked = rankMemories(memories, files, query, vector).slice(0, 20);
  const selected = await Memory.find({
    ...ownerSearchScope(userId),
    _id: {$in: ranked.map(row => row.id)},
  }).select('+search_index');
  const currentFiles = await loadSearchPhotos(userId, selected);
  const currentSources = await loadChatSources(
    userId,
    selected.map(memory => memory.toObject({transform: false})),
  );
  const sourceById = new Map(
    currentSources.map(memory => [idOf(memory), memory]),
  );
  const byId = new Map(selected.map(memory => [memory.id, memory]));
  const original = new Map(memories.map(memory => [idOf(memory), memory]));
  const currentRank = ranked
    .flatMap(row => {
      const memory = sourceById.get(row.id);
      if (!memory) return [];
      const unchanged =
        fingerprint(memory, currentFiles) ===
        fingerprint(original.get(row.id), files);
      // Recheck source freshness, preserving the confidence measured against the
      // full collection rather than recalibrating on only the selected matches.
      if (unchanged && (!row.semantic || hasFreshIndex(memory, currentFiles)))
        return [row];
      return rankMemories([memory], currentFiles, query);
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const docs = [];
  for (const row of currentRank) {
    const memory = byId.get(row.id);
    await memory.populate(attachmentPopulate(userId));
    docs.push(memory.toObject());
  }
  return {
    docs,
    totalDocs: docs.length,
    limit: 20,
    page: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
    nextPage: null,
    prevPage: null,
    pagingCounter: 1,
    search: {
      mode: vector ? ('hybrid' as const) : ('keyword' as const),
      preparing,
      limited: memories.some(
        memory =>
          isCoolingDown(memory, files) ||
          (memory.type === 'conversation' && !memory.chat_source?.complete),
      ),
    },
  };
}
