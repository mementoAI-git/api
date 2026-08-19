import Memory from '../../database/model/memory';
import File from '../../database/model/file';
import Prompt, {IPrompt} from '../../database/model/prompt';
import mongoose from 'mongoose';
import {NotFoundException} from '../../../utils/service-error';
import {IReplyPrompt} from './interface';
import {isEmpty} from '../../../utils/helpers';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import * as storage from '../../../services/storage';
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
import {queueAttachmentThumbnailProcessing} from '../../../services/queues/system';

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

const getAnsweredPromptIds = async (user_id: string): Promise<string[]> => {
  const answeredMemories = await Memory.find({
    user: user_id,
    prompt: {$exists: true, $ne: null},
    status: {$ne: 'draft'},
  });

  return answeredMemories
    .map(m => m.prompt?.toString())
    .filter(Boolean) as string[];
};

async function isAiPromptAnswered(
  user_id: string,
  date_key: string,
  prompt_text: string,
): Promise<boolean> {
  const target = normalizeForDedupe(prompt_text);
  if (!target) return false;
  const matches = await Memory.find({
    user: user_id,
    prompt_type: 'ai-generated',
    reflection_day_key: date_key,
    status: {$ne: 'draft'},
  })
    .select('prompt_text')
    .lean();
  return matches.some(
    m => m.prompt_text && normalizeForDedupe(String(m.prompt_text)) === target,
  );
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
    {$match: {_id: {$nin: excludeIds}}},
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
    data: rows,
    message: 'Prompts retrieved successfully',
  };
};

export const getUserPromptResponse = async (id: string, user_id: string) => {
  let memory = await Memory.findOne({user: user_id, prompt: id}).populate({
    path: 'attachments',
    select: '-base64',
    match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
  });

  if (!memory) {
    const prompt = await Prompt.findById(id);
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
) => {
  const {prompt_id, body, tags = [], level = 1} = payload;

  const user = await User.findById(user_id);
  if (isEmpty(user)) {
    throw new NotFoundException('User not found');
  }

  const prompt = await Prompt.findById(prompt_id);
  if (!prompt) {
    throw new NotFoundException('Prompt not found');
  }

  let attachments = payload?.attachments || [];
  if (!isEmpty(files)) {
    const additionalBytes = files.reduce((acc, f) => acc + f.size, 0);
    await storage.checkStorageQuota(user, additionalBytes);
    const unsavedFiles = await Promise.all(
      files.map(file => storage.uploadFile(file, user_id)),
    );

    const savedFiles = await File.insertMany(unsavedFiles);
    await Promise.all(
      savedFiles.map(async file => {
        if (file.type?.startsWith('video/') && file.status === 'processing') {
          const queued = await queueAttachmentThumbnailProcessing(file.id);
          if (!queued) {
            await File.findByIdAndUpdate(file.id, {
              status: 'failed',
              thumbnail: null,
            });
          }
        }
      }),
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
  const {page, limit, ...query} = pagination;

  const queryFilter: any = {category};

  if ('answered' in query) {
    const answeredMemories = await Memory.find({
      user: user_id,
      prompt: {$exists: true, $ne: null},
      status: {$ne: 'draft'},
    });

    const answeredPromptIds = answeredMemories.map(m => m.prompt);

    if (query?.answered === 'true') {
      queryFilter._id = {$in: answeredPromptIds};
    } else {
      queryFilter._id = {$nin: answeredPromptIds};
    }
  }

  const prompts = await Prompt.paginate(queryFilter, {
    page,
    limit,
    sort: {created_at: -1},
  });

  return {
    data: prompts,
    message: 'Prompts retrieved successfully',
  };
};

export const getSuggestions = async (pagination: IPagination) => {
  const {page, limit} = pagination;
  const skip = (Math.max(1, page) - 1) * limit;

  const total = await Prompt.countDocuments({});
  const sampleSize = Math.min(total, skip + limit);
  const docs = await Prompt.aggregate([
    {$sample: {size: sampleSize}},
    {$skip: skip},
    {$limit: limit},
  ]).sort({title: 1});

  const data = {
    docs,
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
      : (ap.prompt as any)._id.toString(),
  );

  const availablePrompts = await Prompt.aggregate([
    {
      $match: {
        _id: {$nin: [...answeredPromptIds, ...activePromptIds]},
      },
    },
    {$sample: {size: limit * 3}},
  ]).sort({title: 1});

  const categoryMap = new Map<string, any>();

  for (const prompt of availablePrompts) {
    const cat = prompt.category;
    if (cat) {
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

export const getPromptDetails = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Prompt not found');
  }

  const prompt = await Prompt.findById(id);
  if (!prompt) {
    throw new NotFoundException('Prompt not found');
  }

  return {
    data: prompt,
    message: 'Prompt details retrieved successfully',
  };
};

export const getCategories = async () => {
  const categories = await Prompt.distinct('category');
  return {
    data: categories.filter(Boolean),
    message: 'Categories retrieved successfully',
  };
};
