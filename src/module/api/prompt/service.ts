import Memory from '../../database/model/memory';
import File from '../../database/model/file';
import Prompt, { IPrompt } from '../../database/model/prompt';
import { NotFoundException } from '../../../utils/service-error';
import { IReplyPrompt } from './interface';
import { isEmpty } from '../../../utils/helpers';
import * as storage from '../../../services/storage';
import User from '../../database/model/user';
import ActivePrompt from '../../database/model/active-prompt';
import dayjs from 'dayjs';
import { IPagination } from '../../../utils/interface';
import { updateStreak } from '../user/service';

export const getPrompts = async (user_id: string) => {
  const MAX_PROMPT = 2;

  // Get all active prompts for this user
  const todayPrompts = await ActivePrompt.find({
    user: user_id,
    created_at: { $gte: dayjs().subtract(1, 'day').startOf('day').toDate() },
  })
    .populate('prompt')
    .lean();

  const answeredPromptIds = await getAnsweredPromptIds(user_id);
  // If user has prompts from today, return them
  if (todayPrompts.length > 0) {
    const answeredIds = new Set(answeredPromptIds.map(id => id.toString()));
    return {
      data: todayPrompts
        .map(prompt => {
          const promptId =
            typeof prompt.prompt === 'string'
              ? prompt.prompt
              : prompt.prompt._id?.toString();

          return {
            ...prompt,
            answered: promptId ? answeredIds.has(promptId) : false,
          };
        })
        .slice(0, MAX_PROMPT),
      message: 'Prompts retrieved successfully',
    };
  }

  // No prompts from today, assign new daily prompts
  // const answeredPromptIds = await getAnsweredPromptIds(user_id);
  const newPrompts = await assignDailyPrompts(
    user_id,
    answeredPromptIds,
    todayPrompts.map(p => (p.prompt as IPrompt)?._id?.toString() || ''),
  );
  return {
    data: newPrompts,
    message: 'New daily prompts assigned successfully',
  };
};

const getAnsweredPromptIds = async (user_id: string): Promise<string[]> => {
  const answeredMemories = await Memory.find({
    user: user_id,
    prompt: { $exists: true, $ne: null },
  });

  return answeredMemories
    .map(m => m.prompt?.toString())
    .filter(Boolean) as string[];
};

/**
 * Assign 2 new daily prompts to a user
 * Deletes all active prompts for the user and creates new ones for today
 */
const assignDailyPrompts = async (
  user_id: string,
  answeredPromptIds: string[],
  todayPrompts: string[],
): Promise<any[]> => {
  const MAX_PROMPT = 2;

  await ActivePrompt.deleteMany({ user: user_id });

  // Get 2 new prompts excluding answered ones
  const availablePrompts = await Prompt.aggregate([
    {
      $match: {
        _id: { $nin: [...answeredPromptIds, ...todayPrompts] },
      },
    },
    { $sample: { size: MAX_PROMPT } },
  ]);

  if (availablePrompts.length === 0) {
    return [];
  }

  // Create new ActivePrompt records
  await ActivePrompt.insertMany(
    availablePrompts.map(p => ({
      prompt: p._id,
      user: user_id,
    })),
  );

  // Return populated active prompts
  const newActivePrompts = await ActivePrompt.find({
    user: user_id,
    prompt: { $in: availablePrompts.map(p => p._id) },
  })
    .populate('prompt')
    .sort({ created_at: -1 })
    .limit(MAX_PROMPT);

  return newActivePrompts;
};

export const getUserPromptResponse = async (id: string, user_id: string) => {
  let memory = await Memory.findOne({ user: user_id, prompt: id }).populate({
    path: 'attachments',
    select: '-base64',
    match: { provider: { $ne: 's3' } },
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

  return { data: memory, message: 'User prompt response retrieved successfully' };
};

export const replyPrompt = async (
  payload: IReplyPrompt,
  user_id: string,
  files: Express.Multer.File[] | null = null,
) => {
  const { prompt_id, body, tags = [], level = 1 } = payload;

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
    const unsavedFiles = await Promise.all(
      files.map(file => storage.uploadFile(file, user_id)),
    );

    const savedFiles = await File.insertMany(unsavedFiles);
    attachments = [...attachments, ...savedFiles.map(f => f.id)];
  }

  let memory = await Memory.findOne({ user: user_id, prompt: prompt_id });
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
        $addToSet: { attachments: { $each: attachments } },
      },
      { new: true },
    );
  }

  const activePrompt = await ActivePrompt.findOne({
    user: user_id,
    prompt: prompt_id,
  });
  if (activePrompt) {
    await ActivePrompt.findByIdAndUpdate(activePrompt.id, { memory: memory.id });
  }

  // Update streak when user replies to a prompt
  updateStreak(user_id);

  return { data: memory, message: 'Response saved successfully' };
};

export const getPromptsByCategory = async (
  category: string,
  user_id: string,
  pagination: IPagination,
) => {
  const { page, limit, ...query } = pagination;

  let queryFilter: any = { category };

  if ('answered' in query) {
    const answeredMemories = await Memory.find({
      user: user_id,
      prompt: { $exists: true, $ne: null },
    });

    const answeredPromptIds = answeredMemories.map(m => m.prompt);

    if (query?.answered === 'true') {
      queryFilter._id = { $in: answeredPromptIds };
    } else {
      queryFilter._id = { $nin: answeredPromptIds };
    }
  }

  const prompts = await Prompt.paginate(queryFilter, {
    page,
    limit,
    sort: { created_at: -1 },
  });

  return {
    data: prompts,
    message: 'Prompts retrieved successfully',
  };
};

export const getSuggestions = async (pagination: IPagination) => {
  const { page, limit } = pagination;

  const data = await Prompt.paginate(
    {},
    {
      page,
      limit,
      sort: { created_at: -1 },
    },
  );

  return {
    data,
    message: 'Suggestions retrieved successfully',
  };
};

export const getOverviewPrompts = async (user_id: string) => {
  const limit = 10;

  const answeredMemories = await Memory.find({
    user: user_id,
    prompt: { $exists: true, $ne: null },
  });

  const answeredPromptIds = answeredMemories
    .map(m => m.prompt?.toString())
    .filter(Boolean) as string[];

  const activePrompts = await ActivePrompt.find({ user: user_id });
  const activePromptIds = activePrompts.map(ap =>
    typeof ap.prompt === 'string'
      ? ap.prompt
      : (ap.prompt as any)._id.toString(),
  );

  const availablePrompts = await Prompt.aggregate([
    {
      $match: {
        _id: { $nin: [...answeredPromptIds, ...activePromptIds] },
      },
    },
    { $sample: { size: limit * 3 } },
  ]).sort({ title: 1 });

  // Group prompts by category and select one from each
  const categoryMap = new Map<string, any>();

  for (const prompt of availablePrompts) {
    const category = prompt.category;
    if (category) {
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }

      const categoryPrompts = categoryMap.get(category)!;
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
  const prompt = await Prompt.findById(id);
  if (!prompt) {
    throw new NotFoundException('Prompt not found');
  }

  return {
    data: prompt,
    message: 'Prompt details retrieved successfully',
  };
};
