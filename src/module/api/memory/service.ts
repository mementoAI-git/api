import dayjs from 'dayjs';
import {FilterQuery} from 'mongoose';
import Memory, {IMemory} from '../../database/model/memory';
import File from '../../database/model/file';
import User from '../../database/model/user';
import Group from '../../database/model/group';
import Beneficiary from '../../database/model/beneficiary';
import {IPagination} from '../../../utils/interface';
import {
  BadRequestException,
  NotFoundException,
  ServiceError,
} from '../../../utils/service-error';
import {StatusCodes} from 'http-status-codes';
import {
  IAddMessageToMemory,
  ICreateMemoryPayload,
  IDeleteMemoryPayload,
  IQuickCapturePayload,
} from './interface';
import Bookmark from '../../database/model/bookmarks';
import {track} from '../activity/service';
import {
  filterGenerator,
  MEMORY_STATUS,
  MEMORY_VISIBILITY,
  emptyPaginatedList,
  isEmpty,
  formatBytes,
  EXCLUDED_STORAGE_PROVIDER,
} from '../../../utils';
import Prompt from '../../database/model/prompt';
import {updateStreak} from '../user/service';
import Message from '../../database/model/message';
import {updateMemoryTitle} from '../ai/utils';
import ActivePrompt from '../../database/model/active-prompt';
import {queueStoryInsights} from '../../../services/queues/insights';
import {queueQuickCaptureEnrichment} from '../../../services/queues/quick-capture';
import {queueSummarization} from '../../../services/queues/summarization';
import {
  getConversationEnrichment,
  invalidateEnrichmentCache,
} from '../../../services/enrichment';
import {assertOwnedMemory, assertReadableMemory} from './access';
import {assertOwnedFileIds} from '../file/access';
import {persistUploadedFiles} from '../file/service';
import {getStorageUsageSummary} from '../billing/storage-quota';
import {toPublicMemory} from './public-dto';
import {withOperationLock} from '../../../services/operation-lock';

export {getConversationEnrichment};

export async function getMemoryAttachments(memory_id: string, user_id: string) {
  const memory = await Memory.findOne({
    _id: memory_id,
    user: user_id,
  });

  if (!memory) {
    throw new ServiceError('Memory not found', StatusCodes.NOT_FOUND);
  }

  const fileIds = new Set<string>();

  if (memory.attachments && Array.isArray(memory.attachments)) {
    memory.attachments.forEach(id => {
      if (id) fileIds.add(id.toString());
    });
  }

  const messages = await Message.find({
    memory: memory_id,
    $or: [
      {attachments: {$exists: true, $not: {$size: 0}}},
      {attatchments: {$exists: true, $not: {$size: 0}}},
    ],
  }).select('attachments attatchments');

  messages.forEach(msg => {
    const anyMsg = msg as any;
    if (anyMsg.attachments && Array.isArray(anyMsg.attachments)) {
      anyMsg.attachments.forEach((id: any) => {
        if (id) fileIds.add(id.toString());
      });
    }
    if (anyMsg.attatchments && Array.isArray(anyMsg.attatchments)) {
      anyMsg.attatchments.forEach((id: any) => {
        if (id) fileIds.add(id.toString());
      });
    }
  });

  const uniqueFileIds = Array.from(fileIds);

  if (uniqueFileIds.length === 0) {
    return [];
  }

  const files = await File.find({
    _id: {$in: uniqueFileIds},
    deleted: false,
    provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
  }).sort({created_at: -1});

  return files;
}

function shareIdsFromMemoryDoc(field: unknown): string[] {
  if (!Array.isArray(field) || field.length === 0) return [];
  const out: string[] = [];
  for (const x of field) {
    if (typeof x === 'string') {
      out.push(x);
    } else if (x && typeof x === 'object' && '_id' in x) {
      const raw = (x as {_id: unknown})._id;
      if (raw) out.push(String(raw));
    }
  }
  return out;
}

/** Specific shares always imply private visibility; everyone only when explicit and no shares. */
function normalizeMemoryVisibility(
  requested: unknown,
  hasSpecificShares: boolean,
): 'private' | 'everyone' {
  if (hasSpecificShares) {
    return MEMORY_VISIBILITY.PRIVATE;
  }
  const v = typeof requested === 'string' ? requested.toLowerCase().trim() : '';
  return v === MEMORY_VISIBILITY.EVERYONE
    ? MEMORY_VISIBILITY.EVERYONE
    : MEMORY_VISIBILITY.PRIVATE;
}

export async function memoryStats(user_id: string) {
  const memory_count = await Memory.countDocuments({
    user: user_id,
    status: {$nin: ['draft', 'deleted']},
  });
  /** Same scope as GET /memories/stories (all tab, not bookmarked/deleted). */
  const stories_count = await Memory.countDocuments({
    user: user_id,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
  });
  const bookmarkedStoryIds = await Bookmark.find({user: user_id}).distinct(
    'memory',
  );
  const stories_bookmarked_count =
    bookmarkedStoryIds.length === 0
      ? 0
      : await Memory.countDocuments({
          user: user_id,
          type: 'story',
          status: {$nin: ['draft', 'deleted']},
          _id: {$in: bookmarkedStoryIds},
        });
  const stories_deleted_count = await Memory.countDocuments({
    user: user_id,
    type: 'story',
    status: 'deleted',
  });
  const quick_capture_pending_count = await Memory.countDocuments({
    user: user_id,
    type: 'story',
    capture_source: 'quick',
    enrichment_status: 'pending',
    status: {$nin: ['draft', 'deleted']},
  });
  const bookmark_count = await Bookmark.countDocuments({user: user_id});
  const media_count = await File.countDocuments({
    user: user_id,
    deleted: false,
    provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
  });

  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - diffToMonday);
  startOfWeek.setHours(0, 0, 0, 0);

  const week_count = await Memory.countDocuments({
    user: user_id,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
    created_at: {$gte: startOfWeek},
  });

  const storageUsage = await getStorageUsageSummary(user_id);
  const storage_size = storageUsage.used_bytes;
  const storage_limit = storageUsage.limit_bytes;

  const data = {
    memory_count,
    stories_count,
    week_count,
    weekly_count: week_count,
    stories_bookmarked_count,
    stories_deleted_count,
    bookmark_count,
    quick_capture_pending_count,
    media_count,
    storage: `${formatBytes(storage_size)}/${formatBytes(storage_limit)}`,
  };

  return {
    data,
    message: 'Memory stats retrieved successfully',
  };
}

export async function createMemory(
  payload: ICreateMemoryPayload,
  user_id: string,
  files: Express.Multer.File[] | null = null,
  reservationId?: string,
) {
  const {
    title,
    body,
    status,
    tags = [],
    level = 1,
    groups: groupIds = [],
    beneficiaries: beneficiaryIds = [],
    visibility: visibilityRaw,
  } = payload;
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  let validGroupIds: string[] = [];
  if (!isEmpty(groupIds)) {
    const groups = await Group.find({_id: {$in: groupIds}, user: user_id});
    validGroupIds = groups.map(g => g.id);
  }

  let validBeneficiaryIds: string[] = [];
  if (!isEmpty(beneficiaryIds)) {
    const beneficiaries = await Beneficiary.find({
      _id: {$in: beneficiaryIds},
      benefactor: user_id,
    });
    validBeneficiaryIds = beneficiaries.map(b => b.id);
  }

  let attachments = await assertOwnedFileIds(
    user_id,
    payload?.attachments || [],
  );
  if (!isEmpty(files)) {
    const savedFiles = await persistUploadedFiles(
      files,
      user_id,
      undefined,
      reservationId,
    );
    attachments = [...attachments, ...savedFiles.map(f => f.id)];
  }

  const hasSpecificShares =
    !isEmpty(validGroupIds) || !isEmpty(validBeneficiaryIds);
  const visibility = normalizeMemoryVisibility(
    visibilityRaw,
    hasSpecificShares,
  );

  const memory = await Memory.create({
    title,
    user: user_id,
    body,
    level,
    status,
    tags,
    attachments,
    visibility,
    ...(!isEmpty(validGroupIds) && {groups: validGroupIds}),
    ...(!isEmpty(validBeneficiaryIds) && {beneficiaries: validBeneficiaryIds}),
    ...(status === MEMORY_STATUS.SAVE &&
      body &&
      body.trim().length > 0 &&
      tags.length === 0 && {enrichment_status: 'pending'}),
  });

  // Track activity only if published
  if (status !== MEMORY_STATUS.DRAFT) {
    await track(
      {
        title: 'Memory Created',
        description: `Created memory: "${title}"`,
        type: 'memory',
        action: 'created',
        reference: memory.id,
      },
      user_id,
    );
  }

  // Queue story insights extraction if it's a story with body content and status is "save"
  const isStory = !memory.type || memory.type === 'story';
  if (isStory && status === 'save' && body && body.trim().length > 0) {
    void queueStoryInsights(user_id, memory.id);
    void queueSummarization(memory.id, 'story');
    if ((memory.tags?.length || 0) === 0) {
      void queueQuickCaptureEnrichment({
        user_id,
        memory_id: memory.id,
      });
    }
  }

  void updateStreak(user_id);

  // Bust enrichment cache so next stats call recomputes with the new memory/story
  if (isStory && status === 'save') {
    void invalidateEnrichmentCache(user_id);
  }

  return {
    message: 'Memory created successfully',
    data: memory,
  };
}

const QUICK_CAPTURE_PLACEHOLDER_TITLE = 'Thought';
const PROMPT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function quickCaptureMemory(
  payload: IQuickCapturePayload,
  user_id: string,
  files: Express.Multer.File[] | null = null,
  reservationId?: string,
) {
  let body = (payload.body || '').trim();
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  if (
    payload.visibility !== undefined &&
    String(payload.visibility).toLowerCase() !== MEMORY_VISIBILITY.PRIVATE
  ) {
    throw new BadRequestException('Quick capture stories are private only.');
  }

  const promptType = payload.prompt_type;
  const reflectionDayKey = (payload.reflection_day_key || '').trim();
  let promptFields: Record<string, string> = {};

  if (promptType) {
    if (!PROMPT_DATE_RE.test(reflectionDayKey)) {
      throw new BadRequestException(
        'A valid reflection day is required for prompt responses.',
      );
    }
    if (promptType === 'static') {
      const pid = String(payload.prompt_id || '').trim();
      if (!pid) {
        throw new BadRequestException('prompt_id is required');
      }
      const p = await Prompt.findById(pid);
      if (!p) {
        throw new BadRequestException('Prompt not found');
      }
      promptFields = {
        prompt: pid,
        prompt_text: p.title,
        prompt_type: 'static',
        reflection_day_key: reflectionDayKey,
      };
    } else {
      const ptext = String(payload.prompt_text || '').trim();
      if (!ptext) {
        throw new BadRequestException('prompt_text is required');
      }
      promptFields = {
        prompt_text: ptext,
        prompt_type: 'ai-generated',
        reflection_day_key: reflectionDayKey,
      };
    }
  }

  let validBeneficiaryIds: string[] = [];
  let beneficiaryIds: string[] = [];
  const rawBen = payload.beneficiaries;
  if (typeof rawBen === 'string' && rawBen.trim()) {
    beneficiaryIds = rawBen
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawBen)) {
    beneficiaryIds = rawBen.filter(Boolean);
  }

  if (!isEmpty(beneficiaryIds)) {
    const beneficiaries = await Beneficiary.find({
      _id: {$in: beneficiaryIds},
      benefactor: user_id,
    });
    validBeneficiaryIds = beneficiaries.map(b => b.id);
  }

  let attachments: string[] = [];
  const rawAtt = payload.attachments;
  if (typeof rawAtt === 'string' && rawAtt.trim()) {
    attachments = rawAtt
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawAtt)) {
    attachments = rawAtt.filter(Boolean);
  }
  attachments = await assertOwnedFileIds(user_id, attachments);

  if (!isEmpty(files)) {
    const savedFiles = await persistUploadedFiles(
      files,
      user_id,
      undefined,
      reservationId,
    );
    attachments = [...attachments, ...savedFiles.map(f => f.id)];
  }

  const hasText = body.length > 0;
  const hasFiles = attachments.length > 0;
  if (!hasText && !hasFiles) {
    throw new BadRequestException(
      'Add something to save — a note, voice, or photo.',
    );
  }

  if (!hasText && hasFiles) {
    body = '<p></p>';
  }

  const transcriptUncertain =
    payload.transcript_uncertain === true ||
    payload.transcript_uncertain === 'true';

  const memory = await Memory.create({
    title: QUICK_CAPTURE_PLACEHOLDER_TITLE,
    user: user_id,
    body,
    level: 1,
    status: MEMORY_STATUS.SAVE,
    tags: [],
    attachments,
    type: 'story',
    capture_source: 'quick',
    enrichment_status: 'pending',
    visibility: MEMORY_VISIBILITY.PRIVATE,
    ...promptFields,
    ...(!isEmpty(validBeneficiaryIds) && {beneficiaries: validBeneficiaryIds}),
  });

  if (promptFields.prompt) {
    const activePrompt = await ActivePrompt.findOne({
      user: user_id,
      prompt: promptFields.prompt,
    });
    if (activePrompt) {
      await ActivePrompt.findByIdAndUpdate(activePrompt.id, {
        memory: memory.id,
      });
    }
  }

  await track(
    {
      title: 'Quick capture created',
      description: `Quick capture: "${memory.id}"`,
      type: 'memory',
      action: 'created',
      reference: memory.id,
    },
    user_id,
  );

  void queueQuickCaptureEnrichment({
    user_id,
    memory_id: memory.id,
    transcript_uncertain: transcriptUncertain,
  });
  void updateStreak(user_id);

  return {
    message: 'Thought saved',
    data: memory,
  };
}

async function paginateMemories(
  filter: FilterQuery<IMemory>,
  user_id: string,
  options: {page: number; limit: number; bookmarked?: boolean},
) {
  const {page, limit, bookmarked = false} = options;
  let query = filter;
  let bookmarkedIds: Set<string> = new Set();

  if (bookmarked) {
    const userBookmarks = await Bookmark.find({user: user_id});
    const memoryIds = userBookmarks.map(b => b.memory);
    if (memoryIds.length === 0) {
      return emptyPaginatedList({limit, page});
    }
    query = {$and: [filter, {_id: {$in: memoryIds}}]};
    bookmarkedIds = new Set(memoryIds);
  }

  const memories = await Memory.paginate(query, {
    page,
    limit,
    sort: {created_at: -1},
    populate: [
      {
        path: 'attachments',
        select: '-base64',
        match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
      },
      {path: 'prompt', select: 'title'},
      {path: 'groups', select: 'name description'},
      {path: 'beneficiaries', select: 'name email relationship'},
    ],
  });

  if (!bookmarked) {
    const memoryIds = memories.docs.map(memory => memory.id);
    const userBookmarks = await Bookmark.find({
      memory: {$in: memoryIds},
      user: user_id,
    });
    bookmarkedIds = new Set(userBookmarks.map(bookmark => bookmark.memory));
  }

  return {
    ...memories,
    docs: memories.docs.map(memory => {
      const obj = memory.toObject() as unknown as {
        [key: string]: unknown;
        prompt_text?: string;
        prompt?: {title?: string} | string;
      };
      const promptTitle =
        typeof obj.prompt === 'object' && obj.prompt
          ? obj.prompt.title || ''
          : '';
      return {
        ...obj,
        prompt_text: obj.prompt_text || promptTitle || undefined,
        bookmarked: bookmarkedIds.has(memory.id),
      };
    }),
  };
}

export async function getMemories(
  payload: IPagination & {status?: string},
  user_id: string,
) {
  const {
    page,
    limit,
    search,
    bookmarked = false,
    deleted = false,
    status,
  } = payload;
  const filters = filterGenerator({search}, ['title', 'body', 'tags']);

  filters.push({
    user: user_id,
    status: status || (deleted ? 'deleted' : {$nin: ['draft', 'deleted']}),
  });

  const data = await paginateMemories({$and: filters}, user_id, {
    page,
    limit,
    bookmarked,
  });

  return {data, message: 'User memories retrieved successfully'};
}

export async function getConversationMemories(
  payload: IPagination,
  user_id: string,
) {
  const {page, limit, search, bookmarked = false, deleted = false} = payload;

  const filters = filterGenerator({search}, ['title', 'body', 'tags']);

  filters.push({
    user: user_id,
    type: 'conversation',
    status: deleted ? 'deleted' : {$nin: ['draft', 'deleted']},
  });

  const data = await paginateMemories({$and: filters}, user_id, {
    page,
    limit,
    bookmarked,
  });

  return {data, message: 'Conversation memories retrieved successfully'};
}

export async function getStoryMemories(
  payload: IPagination & {status?: string},
  user_id: string,
) {
  const {
    page,
    limit,
    search,
    bookmarked = false,
    deleted = false,
    status,
  } = payload;

  const filters = filterGenerator({search}, ['title', 'body', 'tags']);
  filters.push({
    user: user_id,
    type: 'story',
    status: status || (deleted ? 'deleted' : {$nin: ['draft', 'deleted']}),
  });

  const data = await paginateMemories({$and: filters}, user_id, {
    page,
    limit,
    bookmarked,
  });

  return {data, message: 'Story memories retrieved successfully'};
}

export async function getMemory(_id: string, user_id: string = null) {
  const memory = await assertReadableMemory(_id, {userId: user_id});
  await memory.populate([
    {
      path: 'attachments',
      select: '-base64',
      match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
    },
    {path: 'groups', select: 'name description'},
    {path: 'beneficiaries', select: 'name email relationship'},
  ]);

  const bookmark_count = await Bookmark.countDocuments({
    memory: memory.id,
    user: user_id,
  });

  const data = {...memory.toObject(), bookmarked: bookmark_count > 0};

  return {data, message: 'User memory retrieved successfully'};
}

export async function getPublicMemory(_id: string) {
  const memory = await Memory.findOne({
    _id,
    visibility: MEMORY_VISIBILITY.EVERYONE,
    status: {$nin: ['draft', 'deleted']},
  }).populate({
    path: 'attachments',
    match: {
      deleted: {$ne: true},
      provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
    },
  });
  if (!memory) throw new NotFoundException('Memory not found');

  return {
    data: toPublicMemory(memory),
    message: 'Public memory retrieved successfully',
  };
}

export async function getMemoryByPrompt(
  prompt_id: string,
  user_id: string = null,
) {
  let memory = null;
  memory = await Memory.findOne({
    prompt: prompt_id,
    user: user_id,
    status: {$nin: ['draft', 'deleted']},
  });

  if (!memory) {
    const prompt = await Prompt.findById(prompt_id);
    if (!prompt) {
      throw new NotFoundException('Memory not found');
    }

    memory = {title: prompt.title};
  }

  return {
    data: memory,
    message: 'User memory retrieved successfully',
  };
}

export async function updateMemory(
  _id: string,
  payload: Partial<IMemory>,
  user_id: string,
) {
  const {
    status,
    attachments = [],
    body,
    title,
    tags,
    level,
    groups: groupIds,
    beneficiaries: beneficiaryIds,
    visibility: visibilityRaw,
  } = payload;
  const memory = await Memory.findOne({_id, user: user_id});
  if (!memory) {
    throw new NotFoundException('Memory not found');
  }
  const validatedAttachmentIds = await assertOwnedFileIds(
    user_id,
    attachments.map(String),
  );

  let resolvedGroupIds: string[] | undefined;
  if (groupIds !== undefined) {
    if (isEmpty(groupIds)) {
      resolvedGroupIds = [];
    } else {
      const groups = await Group.find({_id: {$in: groupIds}, user: user_id});
      resolvedGroupIds = groups.map(g => g.id);
    }
  }

  let resolvedBeneficiaryIds: string[] | undefined;
  if (beneficiaryIds !== undefined) {
    if (isEmpty(beneficiaryIds)) {
      resolvedBeneficiaryIds = [];
    } else {
      const beneficiaries = await Beneficiary.find({
        _id: {$in: beneficiaryIds},
        benefactor: user_id,
      });
      resolvedBeneficiaryIds = beneficiaries.map(b => b.id);
    }
  }

  const setPayload: Record<string, unknown> = {
    title: title ?? memory?.title,
    body: body ?? memory?.body,
    level: level ?? memory?.level,
    status: status ?? memory?.status,
    tags: tags ?? memory?.tags,
    last_active: dayjs().toDate(),
  };
  if (groupIds !== undefined) {
    setPayload.groups = resolvedGroupIds;
  }
  if (beneficiaryIds !== undefined) {
    setPayload.beneficiaries = resolvedBeneficiaryIds;
  }

  const effectiveGroupIds =
    resolvedGroupIds !== undefined
      ? resolvedGroupIds
      : shareIdsFromMemoryDoc(memory.get('groups'));
  const effectiveBenIds =
    resolvedBeneficiaryIds !== undefined
      ? resolvedBeneficiaryIds
      : shareIdsFromMemoryDoc(memory.get('beneficiaries'));
  const hasSpecificShares =
    !isEmpty(effectiveGroupIds) || !isEmpty(effectiveBenIds);

  const shouldNormalizeVisibility =
    visibilityRaw !== undefined ||
    groupIds !== undefined ||
    beneficiaryIds !== undefined;
  if (shouldNormalizeVisibility) {
    const requested =
      visibilityRaw !== undefined
        ? visibilityRaw
        : (memory.visibility ?? MEMORY_VISIBILITY.PRIVATE);
    setPayload.visibility = normalizeMemoryVisibility(
      requested,
      hasSpecificShares,
    );
  }

  const updatedMemory = await Memory.findByIdAndUpdate(
    _id,
    {
      $set: setPayload,
      ...(validatedAttachmentIds.length > 0 && {
        $addToSet: {attachments: {$each: validatedAttachmentIds}},
      }),
    },
    {new: true},
  );

  const hasChanges =
    (updatedMemory?.title && updatedMemory?.title !== memory?.title) ||
    (updatedMemory?.body && updatedMemory?.body !== memory?.body) ||
    (updatedMemory?.status && updatedMemory?.status !== memory?.status);

  if (hasChanges && updatedMemory?.status === MEMORY_STATUS.SAVE) {
    void queueStoryInsights(user_id, updatedMemory.id);
    void queueSummarization(updatedMemory.id, 'story');
    if (
      (updatedMemory.tags?.length || 0) === 0 &&
      updatedMemory.body &&
      updatedMemory.body.trim().length > 0
    ) {
      await Memory.findByIdAndUpdate(updatedMemory.id, {
        enrichment_status: 'pending',
      });
      void queueQuickCaptureEnrichment({
        user_id,
        memory_id: updatedMemory.id,
      });
    }
  }

  if (updatedMemory?.status !== MEMORY_STATUS.DRAFT) {
    await track(
      {
        title: 'Memory Updated',
        description: `Updated memory: "${updatedMemory?.title || memory.title}"`,
        type: 'memory',
        action: 'updated',
        reference: memory.id,
      },
      user_id,
    );
  }

  return {
    data: updatedMemory ?? memory,
    message: 'Memory updated successfully',
  };
}

export async function deleteMemory(
  payload: IDeleteMemoryPayload,
  user_id: string,
) {
  const {memory_id, delete_permanently = false} = payload;
  const memory = await Memory.findOne({_id: memory_id, user: user_id});

  if (!memory) {
    throw new NotFoundException('Memory not found');
  }

  if (delete_permanently) {
    // Delete all associated messages
    await Message.deleteMany({memory: memory.id});

    // Delete all associated bookmarks
    await Bookmark.deleteMany({memory: memory.id});

    // Mark all associated files as deleted
    if (memory.attachments && memory.attachments.length > 0) {
      await File.updateMany({_id: {$in: memory.attachments}}, {deleted: true});
    }

    // Delete active prompt if it references this memory
    await ActivePrompt.deleteMany({memory: memory.id});

    // Permanently delete the memory
    await Memory.findByIdAndDelete(memory.id);
  } else {
    // Soft delete - just mark as deleted
    await memory.updateOne({status: 'deleted'});

    if (memory.status !== MEMORY_STATUS.DRAFT) {
      await track(
        {
          title: 'Memory Deleted',
          description: `Deleted memory: "${memory.title}"`,
          type: 'memory',
          action: 'deleted',
          reference: memory.id,
        },
        user_id,
      );
    }
  }

  return {data: memory, message: 'Memory deleted successfully'};
}

export async function restoreMemory(_id: string, user_id: string) {
  const memory = await Memory.findOne({_id, user: user_id});
  if (!memory) {
    throw new NotFoundException('Memory not found');
  }

  if (memory.status !== 'deleted') {
    throw new BadRequestException('Memory is not deleted');
  }

  // Restore to 'save' status (or you could restore to previous status if you track it)
  await memory.updateOne({status: 'save'});
  void invalidateEnrichmentCache(user_id);

  await track(
    {
      title: 'Memory Restored',
      description: `Restored memory: "${memory.title}"`,
      type: 'memory',
      action: 'restored',
      reference: memory.id,
    },
    user_id,
  );

  return {data: memory, message: 'Memory restored successfully'};
}

export async function bookmark(memory_id: string, user_id: string) {
  const memory = await assertReadableMemory(memory_id, {userId: user_id});
  const filter = {memory: memory_id, user: user_id};
  const bookmark = await withOperationLock(
    `bookmark:${user_id}:${memory_id}`,
    async () => {
      const result = await Bookmark.updateOne(
        filter,
        {$setOnInsert: filter},
        {upsert: true},
      );
      const saved = await Bookmark.findOne(filter);
      if (!saved) throw new NotFoundException('Bookmark not found');

      if (result.upsertedCount === 1) {
        await track(
          {
            title: 'Memory Bookmarked',
            description: `Bookmarked memory: "${memory.title}"`,
            type: 'memory',
            action: 'bookmarked',
            reference: memory_id,
          },
          user_id,
        );
      }
      return saved;
    },
  );

  return {
    message: 'Memory bookmarked successfully',
    data: bookmark,
  };
}

export async function unbookmark(memory_id: string, user_id: string) {
  const bookmark = await Bookmark.findOneAndDelete({
    memory: memory_id,
    user: user_id,
  });
  if (!bookmark) {
    throw new NotFoundException('Bookmark not found');
  }

  await track(
    {
      title: 'Memory Unbookmarked',
      description: `Unbookmarked memory: "${memory_id}"`,
      type: 'memory',
      action: 'unbookmarked',
      reference: memory_id,
    },
    user_id,
  );

  return {data: bookmark, message: 'Memory unbookmarked successfully'};
}

export async function removeFileFromMemory(file_id: string, user_id: string) {
  await assertOwnedFileIds(user_id, [file_id]);

  const memory = await Memory.findOne({user: user_id, attachments: file_id});
  if (!memory) throw new NotFoundException('Memory not found');

  return removeFileFromSpecificMemory(memory.id, file_id, user_id);
}

export async function removeFileFromSpecificMemory(
  memory_id: string,
  file_id: string,
  user_id: string,
) {
  await assertOwnedFileIds(user_id, [file_id]);
  const memory = await Memory.findOneAndUpdate(
    {_id: memory_id, user: user_id, attachments: file_id},
    {$pull: {attachments: file_id}},
    {new: true},
  );
  if (!memory) throw new NotFoundException('Memory not found');

  return {
    data: memory,
    message: 'File detached from memory successfully',
  };
}

export async function addMessageToMemory(
  payload: IAddMessageToMemory,
  user_id: string,
) {
  let memory = payload.memory_id
    ? await assertOwnedMemory(payload.memory_id, user_id)
    : null;
  if (!memory && !payload.memory_id) {
    memory = await Memory.findOne({
      session_id: payload.session_id,
      user: user_id,
    });
  }

  if (!memory) {
    memory = await Memory.create({
      user: user_id,
      title: null,
      type: 'conversation',
      status: 'save',
      session_id: payload.session_id || null,
    });
  }

  const messages = [];
  const baseTime = dayjs();

  for (let i = 0; i < payload.messages.length; i++) {
    const message = payload.messages[i];
    const createdMessage = await Message.create({
      user: user_id,
      memory: memory?.id,
      role: message.role,
      text: message.text,
      is_voice: message.is_voice || false,
      duration: message.duration || 0,
      created_at: baseTime.add(i, 'second').toDate(),
    });
    messages.push(createdMessage);
  }

  if (isEmpty(memory?.title)) {
    const userMessage = messages.find(message => message.role === 'user');
    const aiMessage = messages.find(message => message.role === 'ai');
    if (userMessage && aiMessage) {
      void updateMemoryTitle(memory.id, userMessage.text, aiMessage.text);
    } else {
      void memory.updateOne({title: 'Conversation Starts'});
    }
  }

  return {
    data: messages,
    message: 'Message added to memory successfully',
  };
}
