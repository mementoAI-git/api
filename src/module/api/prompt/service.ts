import {createHash} from 'node:crypto';
import {getPromptReplyUserCount} from './reply-user-count';
import {
  findAnsweredPromptMemoryId,
  getAnsweredPromptIds,
  keepAnsweredMemories,
  liveAnswerFilter,
} from './answered-memories';
import Memory, {IMemory} from '../../database/model/memory';
import Prompt, {IPrompt} from '../../database/model/prompt';
import mongoose, {HydratedDocument} from 'mongoose';
import {
  ActionNotAllowed,
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
import {IExploreQuestionFeedback, IReplyPrompt} from './interface';
import {isEmpty} from '../../../utils/helpers';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import User from '../../database/model/user';
import ActivePrompt from '../../database/model/active-prompt';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {IPagination} from '../../../utils/interface';
import {updateStreak} from '../user/service';
import {
  generateDailyAiQuestionWithRetry,
  getCachedAiPrompt,
  normalizeForDedupe,
  setCachedAiPrompt,
} from './daily-ai-prompt';
import {queueQuickCaptureEnrichment} from '../../../services/queues/quick-capture';
import {persistUploadedFiles} from '../file/service';
import ExploreQuestionState from '../../database/model/explore-question-state';
import {
  EXPLORE_CATEGORIES,
  exploreArtworkFor,
  getCompatibleExploreCategoryValues,
  resolveExploreCategorySlug,
} from './explore-taxonomy';
import {
  computeExploreProgress,
  type ExploreQuestionCandidate,
  isExploreQuestionSuppressed,
  selectExploreQuestions,
} from './explore-selection';
import {
  buildExplorePromptScope,
  buildExploreSuggestionScope,
  buildPromptOwnershipScope,
  isExploreQuestionFeedbackStatus,
  withExploreCategoryTitle,
} from './explore-contract';
import {queueExploreQuestionRefill} from '../../../services/queues/explore-questions';
import {BACKEND_URL} from '../../../utils/config';

dayjs.extend(utc);

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STATIC_DAILY = 2;
const AI_LABEL = 'Just for you';

export function resolvePromptDateKey(raw?: string): string {
  if (raw && DATE_KEY_RE.test(String(raw).trim())) {
    return String(raw).trim();
  }
  return dayjs.utc().format('YYYY-MM-DD');
}

async function isAiPromptAnswered(
  user_id: string,
  date_key: string,
  prompt_text: string,
): Promise<boolean> {
  const target = normalizeForDedupe(prompt_text);
  if (!target) return false;
  const matches = await Memory.find({
    ...liveAnswerFilter(user_id),
    prompt_type: 'ai-generated',
    reflection_day_key: date_key,
  })
    .select('prompt_text body attachments')
    .lean();
  const sameQuestion = matches.filter(
    m => m.prompt_text && normalizeForDedupe(String(m.prompt_text)) === target,
  );
  return (await keepAnsweredMemories(sameQuestion)).length > 0;
}

/**
 * Ensure up to 2 catalog prompts are assigned for this calendar day.
 */
const assignDailyPrompts = async (
  user_id: string,
  answeredPromptIds: string[],
  day_key: string,
): Promise<void> => {
  await ActivePrompt.deleteMany({
    user: user_id,
    $or: [{day_key: {$exists: false}}, {day_key: null}, {day_key: ''}],
  });

  const existing = await ActivePrompt.find({user: user_id, day_key}).sort({
    created_at: -1,
  });
  if (existing.length >= MAX_STATIC_DAILY) {
    return;
  }

  const need = MAX_STATIC_DAILY - existing.length;
  const existingIds = existing
    .map(p =>
      typeof p.prompt === 'string'
        ? p.prompt
        : (p.prompt as IPrompt)?._id?.toString(),
    )
    .filter(Boolean) as string[];

  const nin = [...new Set([...answeredPromptIds, ...existingIds])];

  const availablePrompts = await Prompt.aggregate([
    {
      $match: {
        _id: {$nin: nin},
        source: 'starter',
        active: {$ne: false},
      },
    },
    {$sample: {size: need}},
  ]);

  if (availablePrompts.length === 0) {
    return;
  }

  await ActivePrompt.insertMany(
    availablePrompts.map(p => ({
      prompt: p._id,
      user: user_id,
      day_key,
    })),
  );
};

export type DashboardPromptRow =
  | {
      slot_kind: 'ai';
      display_label: string;
      answered: boolean;
      ai_prompt_text: string;
      reflection_day_key: string;
      prompt?: undefined;
    }
  | {
      slot_kind: 'static';
      display_label?: string;
      answered: boolean;
      prompt: IPrompt;
      reflection_day_key: string;
      ai_prompt_text?: undefined;
    };

async function pickFallbackStaticPrompt(
  excludeIds: string[],
): Promise<IPrompt | null> {
  const [doc] = await Prompt.aggregate([
    {
      $match: {
        _id: {$nin: excludeIds},
        source: 'starter',
        active: {$ne: false},
      },
    },
    {$sample: {size: 1}},
  ]);
  if (!doc?._id) {
    return null;
  }
  const full = await Prompt.findById(doc._id).lean();
  return full as IPrompt | null;
}

export const getPrompts = async (user_id: string, date_key?: string) => {
  const dk = resolvePromptDateKey(date_key);
  const answeredPromptIds = await getAnsweredPromptIds(user_id);

  await assignDailyPrompts(user_id, answeredPromptIds, dk);

  const staticRows = await ActivePrompt.find({user: user_id, day_key: dk})
    .populate('prompt')
    .sort({created_at: -1})
    .limit(MAX_STATIC_DAILY);

  const staticPromptDocs = staticRows
    .map(r => r.prompt as IPrompt)
    .filter(p => p && p._id);

  const staticPromptIds = staticPromptDocs
    .map(p => p._id?.toString())
    .filter(Boolean) as string[];

  const answeredSet = new Set(answeredPromptIds.map(String));

  let cachedAi = await getCachedAiPrompt(user_id, dk);
  if (!cachedAi) {
    const generated = await generateDailyAiQuestionWithRetry(user_id);
    if (generated) {
      await setCachedAiPrompt(user_id, dk, generated);
      cachedAi = generated;
    }
  }

  const buildStaticRow = (
    prompt: IPrompt,
    label?: string,
  ): DashboardPromptRow => ({
    slot_kind: 'static',
    display_label: label,
    answered: prompt._id ? answeredSet.has(String(prompt._id)) : false,
    prompt,
    reflection_day_key: dk,
  });

  let firstSlot: DashboardPromptRow | null = null;

  if (cachedAi) {
    const aiAnswered = await isAiPromptAnswered(user_id, dk, cachedAi);
    firstSlot = {
      slot_kind: 'ai',
      display_label: AI_LABEL,
      answered: aiAnswered,
      ai_prompt_text: cachedAi,
      reflection_day_key: dk,
    };
  } else {
    const fallback = await pickFallbackStaticPrompt([
      ...answeredPromptIds,
      ...staticPromptIds,
    ]);
    if (fallback?._id) {
      firstSlot = buildStaticRow(fallback);
    }
  }

  const rows: DashboardPromptRow[] = [];
  const usedStaticIds = new Set<string>();

  if (firstSlot) {
    rows.push(firstSlot);
    if (firstSlot.slot_kind === 'static' && firstSlot.prompt?._id) {
      usedStaticIds.add(String(firstSlot.prompt._id));
    }
  }

  for (const p of staticPromptDocs) {
    const id = p._id?.toString();
    if (id && usedStaticIds.has(id)) {
      continue;
    }
    rows.push(buildStaticRow(p));
    if (id) usedStaticIds.add(id);
  }

  if (rows.length === 0 && staticPromptDocs.length > 0) {
    for (const p of staticPromptDocs) {
      rows.push(buildStaticRow(p));
    }
  }

  return {
    data: await Promise.all(
      rows.map(async row => ({
        ...row,
        reply_user_count: await getPromptReplyUserCount(
          row.slot_kind === 'static'
            ? {prompt_id: String(row.prompt._id)}
            : {prompt_text: row.ai_prompt_text},
        ),
      })),
    ),
    message: 'Prompts retrieved successfully',
  };
};

export const getUserPromptResponse = async (id: string, user_id: string) => {
  const populateAttachments = {
    path: 'attachments',
    select: '-base64',
    match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
  };
  // Prefer the memory that holds the answer; an older empty draft (made by
  // opening the topic earlier) must not hide it.
  const answeredId = await findAnsweredPromptMemoryId(user_id, id);
  let memory = answeredId
    ? await Memory.findOne({_id: answeredId, user: user_id}).populate(
        populateAttachments,
      )
    : await Memory.findOne({
        user: user_id,
        prompt: id,
        status: {$ne: 'deleted'},
        purge_requested_at: null,
      })
        .sort({created_at: 1})
        .populate(populateAttachments);

  if (!memory) {
    const prompt = await Prompt.findOne({
      _id: id,
      ...buildPromptOwnershipScope(user_id),
    });
    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }
    memory = await Memory.create({
      user: user_id,
      status: 'draft',
      title: prompt.title,
      prompt: id,
    });
  }

  return {data: memory, message: 'User prompt response retrieved successfully'};
};

export const replyPrompt = async (
  payload: IReplyPrompt,
  user_id: string,
  files: Express.Multer.File[] | null = null,
  reservationId?: string,
) => {
  const {prompt_id, body, tags = [], level = 1} = payload;

  const user = await User.findById(user_id);
  if (isEmpty(user)) {
    throw new NotFoundException('User not found');
  }

  const prompt = await Prompt.findOne({
    _id: prompt_id,
    ...buildPromptOwnershipScope(user_id),
  });
  if (!prompt) {
    throw new NotFoundException('Prompt not found');
  }

  let attachments = payload?.attachments || [];
  if (!isEmpty(files)) {
    const savedFiles = await persistUploadedFiles(
      files,
      user_id,
      undefined,
      reservationId,
    );
    attachments = [...attachments, ...savedFiles.map(f => f.id)];
  }

  let memory = await Memory.findOne({user: user_id, prompt: prompt_id});
  if (!memory) {
    memory = await Memory.create({
      user: user_id,
      title: prompt?.title,
      prompt: prompt_id,
      body,
      level,
      tags,
      attachments,
    });
  } else {
    memory = await Memory.findByIdAndUpdate(
      memory.id,
      {
        body: body || memory?.body,
        level,
        tags,
        $addToSet: {attachments: {$each: attachments}},
      },
      {new: true},
    );
  }

  const activePrompt = await ActivePrompt.findOne({
    user: user_id,
    prompt: prompt_id,
  });
  if (activePrompt) {
    await ActivePrompt.findByIdAndUpdate(activePrompt.id, {memory: memory.id});
  }

  await ExploreQuestionState.deleteOne({user: user_id, prompt: prompt_id});
  if (prompt.source === 'ai-generated') {
    await Prompt.updateOne(
      {_id: prompt_id, owner_user: user_id},
      {$set: {active: false}},
    );
  }

  const hasBody = Boolean(
    memory?.body && String(memory.body).trim().length > 0,
  );
  const hasNoTags = (memory?.tags?.length || 0) === 0;
  const isSaved = memory?.status && memory.status !== 'draft';
  const isStory = !memory?.type || memory.type === 'story';

  if (isSaved && isStory && hasBody && hasNoTags) {
    await Memory.findByIdAndUpdate(memory.id, {
      enrichment_status: 'pending',
    });
    void queueQuickCaptureEnrichment({
      user_id,
      memory_id: memory.id,
    });
  }

  void updateStreak(user_id);

  return {data: memory, message: 'Response saved successfully'};
};

export const getPromptsByCategory = async (
  category: string,
  user_id: string,
  pagination: IPagination,
) => {
  const canonical = resolveExploreCategorySlug(category);
  if (!canonical) throw new NotFoundException('Explore category not found');

  const page = Math.max(1, pagination.page);
  const limit = Math.max(1, Math.min(50, pagination.limit));
  const compatibleCategories = getCompatibleExploreCategoryValues(canonical);
  const scope = {
    ...buildExplorePromptScope(canonical, user_id),
    category: {$in: compatibleCategories},
  };
  const answeredPromptIds = await getAnsweredPromptIds(user_id);
  const answeredIds = new Set(answeredPromptIds.map(String));
  const starterAnswered = await Prompt.countDocuments({
    _id: {$in: answeredPromptIds},
    category: {$in: compatibleCategories},
    source: 'starter',
  });
  const progress = {
    categorySlug: canonical,
    ...computeExploreProgress(starterAnswered),
  };

  if (pagination.answered === 'true') {
    const prompts = await Prompt.paginate(
      {...scope, _id: {$in: answeredPromptIds}},
      {page, limit, sort: {created_at: -1}},
    );
    return {
      data: {...prompts, progress},
      message: 'Prompts retrieved successfully',
    };
  }

  const [states, promptDocs, usableContextCount] = await Promise.all([
    ExploreQuestionState.find({user: user_id})
      .select('prompt status updated_at')
      .lean(),
    Prompt.find({...scope, active: {$ne: false}})
      .sort({stable_id: 1, created_at: 1})
      .lean(),
    Memory.countDocuments({
      user: user_id,
      status: {$nin: ['draft', 'deleted']},
    }),
  ]);
  const stateByPrompt = new Map(
    states.map(state => [String(state.prompt), state.status]),
  );
  const suppressedIds = new Set(
    states
      .filter(state =>
        isExploreQuestionSuppressed(state.status, state.updated_at),
      )
      .map(state => String(state.prompt)),
  );
  const candidates = promptDocs.map(prompt => ({
    ...prompt,
    _id: String(prompt._id),
    source: prompt.source ?? 'legacy',
    status: answeredIds.has(String(prompt._id))
      ? 'answered'
      : (stateByPrompt.get(String(prompt._id)) ?? 'unanswered'),
  })) as ExploreQuestionCandidate[];
  const personalizedPoolSize = candidates.filter(
    prompt => prompt.source === 'ai-generated',
  ).length;
  if (progress.personalizedQuestionsEnabled && personalizedPoolSize < 3) {
    void queueExploreQuestionRefill({user_id, category: canonical});
  }
  const activeAnsweredIds =
    pagination.answered === 'false' || pagination.answered === undefined
      ? answeredIds
      : new Set<string>();
  const selected = selectExploreQuestions({
    starterQuestions: candidates.filter(prompt => prompt.source === 'starter'),
    personalizedQuestions: candidates.filter(
      prompt => prompt.source === 'ai-generated',
    ),
    answeredIds: activeAnsweredIds,
    suppressedIds,
    starterAnswered,
    usableContextCount,
    limit: candidates.length,
  });
  const offset = (page - 1) * limit;
  const docs = selected.slice(offset, offset + limit);
  const totalDocs = selected.length;
  const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
  const hasNextPage = offset + limit < totalDocs;
  const prompts = {
    docs,
    totalDocs,
    limit,
    page,
    totalPages,
    hasNextPage,
    hasPrevPage: page > 1,
    pagingCounter: totalDocs === 0 ? 0 : offset + 1,
    nextPage: hasNextPage ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
    progress,
  };

  return {
    data: prompts,
    message: 'Prompts retrieved successfully',
  };
};

export const getExploreCategories = async () => ({
  data: EXPLORE_CATEGORIES.map((category, index) => ({
    ...category,
    order: index,
    starterTotal: 10,
    artwork: exploreArtworkFor(category.slug, BACKEND_URL || ''),
  })),
  message: 'Explore categories retrieved successfully',
});

export const setExploreQuestionFeedback = async (
  prompt_id: string,
  payload: IExploreQuestionFeedback,
  user_id: string,
) => {
  if (!isExploreQuestionFeedbackStatus(payload.status)) {
    throw new BadRequestException('Invalid Explore question status');
  }
  const prompt = await Prompt.findById(prompt_id).lean();
  if (!prompt) throw new NotFoundException('Prompt not found');
  if (!resolveExploreCategorySlug(prompt.category)) {
    throw new BadRequestException('Prompt is not an Explore question');
  }
  if (
    prompt.source === 'ai-generated' &&
    String(prompt.owner_user) !== String(user_id)
  ) {
    throw new ActionNotAllowed('Prompt does not belong to this user');
  }
  const state = await ExploreQuestionState.findOneAndUpdate(
    {user: user_id, prompt: prompt_id},
    {$set: {status: payload.status}},
    {new: true, upsert: true},
  );
  return {data: state, message: 'Explore question feedback saved'};
};

async function getSuppressedExplorePromptIds(userId: string) {
  const states = await ExploreQuestionState.find({user: userId})
    .select('prompt status updated_at')
    .lean();
  return states
    .filter(state =>
      isExploreQuestionSuppressed(state.status, state.updated_at),
    )
    .map(state => String(state.prompt));
}

export const getSuggestions = async (
  pagination: IPagination,
  user_id: string,
) => {
  const {page, limit} = pagination;
  const skip = (Math.max(1, page) - 1) * limit;

  const suppressedIds = await getSuppressedExplorePromptIds(user_id);
  const suggestionScope = buildExploreSuggestionScope(user_id, suppressedIds);
  const total = await Prompt.countDocuments(suggestionScope);
  const sampleSize = Math.min(total, skip + limit);
  const docs = await Prompt.aggregate<IPrompt>([
    {$match: suggestionScope},
    {$sample: {size: sampleSize}},
    {$skip: skip},
    {$limit: limit},
  ]).sort({title: 1});

  const data = {
    docs: docs.map(withExploreCategoryTitle),
    totalDocs: total,
    limit,
    page: Math.max(1, page),
    totalPages: Math.ceil(total / limit) || 1,
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
    pagingCounter: skip + 1,
    nextPage: page * limit < total ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
  };

  return {
    data,
    message: 'Suggestions retrieved successfully',
  };
};

export const getOverviewPrompts = async (user_id: string) => {
  const limit = 10;

  const answeredMemories = await Memory.find({
    user: user_id,
    prompt: {$exists: true, $ne: null},
    status: {$ne: 'draft'},
  });

  const answeredPromptIds = answeredMemories
    .map(m => m.prompt?.toString())
    .filter(Boolean) as string[];

  const activePrompts = await ActivePrompt.find({user: user_id});
  const activePromptIds = activePrompts.map(ap =>
    typeof ap.prompt === 'string'
      ? ap.prompt
      : String((ap.prompt as IPrompt)._id),
  );
  const suppressedIds = await getSuppressedExplorePromptIds(user_id);

  type OverviewPrompt = IPrompt & {category_title?: string};
  const availablePrompts = await Prompt.aggregate<OverviewPrompt>([
    {
      $match: {
        ...buildExploreSuggestionScope(user_id, [
          ...answeredPromptIds,
          ...activePromptIds,
          ...suppressedIds,
        ]),
      },
    },
    {$sample: {size: limit * 3}},
  ]).sort({title: 1});

  const categoryMap = new Map<string, OverviewPrompt[]>();

  for (const prompt of availablePrompts) {
    const cat = resolveExploreCategorySlug(prompt.category);
    if (cat) {
      const categoryDefinition = EXPLORE_CATEGORIES.find(
        category => category.slug === cat,
      );
      prompt.category = cat;
      prompt.category_title = categoryDefinition?.title ?? cat;
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
      }

      const categoryPrompts = categoryMap.get(cat)!;
      if (categoryPrompts.length < 2) {
        categoryPrompts.push(prompt);
      }
    }
  }

  const distinctCategoryPrompts = Array.from(categoryMap.values())
    .flat()
    .sort(() => Math.random() - 0.5);

  return {
    data: distinctCategoryPrompts.flat(),
    message: 'Overview prompts retrieved successfully',
  };
};

export const getPromptDetails = async (id: string, user_id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Prompt not found');
  }

  const prompt = await Prompt.findOne({
    _id: id,
    ...buildPromptOwnershipScope(user_id),
  });
  if (!prompt) {
    throw new NotFoundException('Prompt not found');
  }

  return {
    data: prompt,
    message: 'Prompt details retrieved successfully',
  };
};

export async function openReflectionConversation(
  userId: string,
  input: {
    prompt_type: 'static' | 'ai-generated';
    prompt_id?: string;
    prompt_text?: string;
    reflection_day_key: string;
  },
) {
  const day = input.reflection_day_key;
  const existingReady = Memory.findOne({
    user: userId,
    prompt_type: input.prompt_type,
    reflection_day_key: day,
    ...(input.prompt_type === 'static'
      ? {prompt: input.prompt_id}
      : {prompt_text: input.prompt_text?.trim()}),
    status: {$ne: 'deleted'},
    purge_requested_at: null,
  })
    .sort({created_at: 1})
    .exec();
  let existing: HydratedDocument<IMemory> | null;
  let title: string;
  let promptId: string | undefined;
  let category: string | undefined;
  if (input.prompt_type === 'static') {
    const [prompt, assigned, found] = await Promise.all([
      Prompt.findOne({
        _id: input.prompt_id,
        ...buildPromptOwnershipScope(userId),
      }),
      ActivePrompt.exists({
        user: userId,
        prompt: input.prompt_id,
        day_key: day,
      }),
      existingReady,
    ]);
    existing = found;
    if (!prompt || (!assigned && prompt.source !== 'starter'))
      throw new BadRequestException('Daily question not found');
    title = prompt.title;
    promptId = prompt.id;
    category = prompt.category;
  } else {
    const [cached, found] = await Promise.all([
      getCachedAiPrompt(userId, day),
      existingReady,
    ]);
    existing = found;
    if (!cached || cached !== input.prompt_text?.trim())
      throw new BadRequestException('Daily question not found');
    title = cached;
  }
  const fields = {
    user: userId,
    prompt_type: input.prompt_type,
    reflection_day_key: day,
    ...(promptId ? {prompt: promptId} : {prompt_text: title}),
  };
  // Keep legacy answers and their original IDs, bodies, attachments and sharing.
  if (existing) return {message: 'Reflection ready', data: existing};
  // Deterministic ID makes simultaneous opens idempotent without a schema migration.
  const id = createHash('sha256')
    .update(JSON.stringify([userId, day, input.prompt_type, promptId || title]))
    .digest('hex')
    .slice(0, 24);
  let data: HydratedDocument<IMemory> | null;
  try {
    data = await Memory.findOneAndUpdate(
      {
        _id: id,
        user: userId,
        status: {$ne: 'deleted'},
        purge_requested_at: null,
      },
      {
        $setOnInsert: {
          ...fields,
          title,
          prompt_text: title,
          category,
          type: 'conversation',
          status: 'draft',
          visibility: 'private',
        },
      },
      {upsert: true, new: true, setDefaultsOnInsert: true},
    );
  } catch (error) {
    if ((error as {code?: number}).code !== 11000) throw error;
    // Concurrent upserts with ownership/status predicates can race on the ID index.
    data = await Memory.findOne({
      _id: id,
      user: userId,
      status: {$ne: 'deleted'},
      purge_requested_at: null,
    });
    if (!data) throw error;
  }
  return {message: 'Reflection ready', data};
}
