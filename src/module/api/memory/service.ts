import dayjs from "dayjs";
import { FilterQuery } from "mongoose";
import Memory, { IMemory } from "../../database/model/memory";
import File from "../../database/model/file";
import User from "../../database/model/user";
import Group from "../../database/model/group";
import Beneficiary from "../../database/model/beneficiary";
import { IPagination } from "../../../utils/interface";
import { BadRequestException, NotFoundException } from "../../../utils/service-error";
import { IAddMessageToMemory, ICreateMemoryPayload, IDeleteMemoryPayload } from "./interface";
import Bookmark from "../../database/model/bookmarks";
import { track } from "../activity/service";
import {
  filterGenerator,
  MEMORY_STATUS,
  emptyPaginatedList,
  isEmpty,
  STORAGE_PROVIDERS,
  formatBytes,
  FREE_STORAGE_LIMIT_BYTES,
} from "../../../utils";
import Prompt from "../../database/model/prompt";
import { updateStreak } from "../user/service";
import Message from "../../database/model/message";
import { updateMemoryTitle } from "../ai/utils";
import ActivePrompt from "../../database/model/active-prompt";
import { queueStoryInsights } from "../../../services/queues/insights";
import { queueSummarization } from "../../../services/queues/summarization";
import * as storage from "../../../services/storage";

export async function memoryStats(user_id: string) {
  const memory_count = await Memory.countDocuments({
    user: user_id,
    status: { $nin: ["draft", "deleted"] }
  })
  const bookmark_count = await Bookmark.countDocuments({ user: user_id })
  const media_count = await File.countDocuments({
    user: user_id,
    deleted: false,
    provider: { $ne: STORAGE_PROVIDERS.s3 }
  })

  const user = await User.findById(user_id).select('storage_limit').lean()

  const storage_size = await storage.getUserStorageUsed(user_id)
  const storage_limit = user?.storage_limit || FREE_STORAGE_LIMIT_BYTES

  const data = {
    memory_count,
    bookmark_count,
    media_count,
    storage: `${formatBytes(storage_size)}/${formatBytes(storage_limit)}`,
  }

  return {
    data,
    message: "Memory stats retrieved successfully"
  }
}

export async function createMemory(payload: ICreateMemoryPayload, user_id: string, files: Express.Multer.File[] | null = null) {
  const { title, body, status, tags = [], level = 1, groups: groupIds = [], beneficiaries: beneficiaryIds = [] } = payload
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  let validGroupIds: string[] = []
  if (!isEmpty(groupIds)) {
    const groups = await Group.find({ _id: { $in: groupIds }, user: user_id })
    validGroupIds = groups.map((g) => g.id)
  }

  let validBeneficiaryIds: string[] = []
  if (!isEmpty(beneficiaryIds)) {
    const beneficiaries = await Beneficiary.find({ _id: { $in: beneficiaryIds }, benefactor: user_id })
    validBeneficiaryIds = beneficiaries.map((b) => b.id)
  }

  let attachments = payload?.attachments || []
  if (!isEmpty(files)) {
    const additionalBytes = files.reduce((acc, f) => acc + f.size, 0)
    await storage.checkStorageQuota(user, additionalBytes)
    const unsavedFiles = await Promise.all(
      files.map((file) => storage.uploadFile(file, user_id))
    )

    const savedFiles = await File.insertMany(unsavedFiles)
    attachments = [...attachments, ...savedFiles.map(f => f.id)]
  }

  const memory = await Memory.create({
    title,
    user: user_id,
    body,
    level,
    status,
    tags,
    attachments,
    ...(!isEmpty(validGroupIds) && { groups: validGroupIds }),
    ...(!isEmpty(validBeneficiaryIds) && { beneficiaries: validBeneficiaryIds }),
  })

  // Track activity
  await track({
    title: "Memory Created",
    description: `Created memory: "${title}"`,
    type: "memory",
    action: "created",
    reference: memory.id
  }, user_id)

  // Queue story insights extraction if it's a story with body content and status is "save"
  const isStory = !memory.type || memory.type === "story";
  if (isStory && status === "save" && body && body.trim().length > 0) {
    queueStoryInsights(user_id, memory.id);
    queueSummarization(memory.id, "story");
  }

  updateStreak(user_id)

  return {
    message: "Memory created successfully",
    data: memory
  }
}

async function paginateMemories(
  filter: FilterQuery<IMemory>,
  user_id: string,
  options: { page: number; limit: number; bookmarked?: boolean }
) {
  const { page, limit, bookmarked = false } = options;
  let query = filter;
  let bookmarkedIds: Set<string> = new Set();

  if (bookmarked) {
    const userBookmarks = await Bookmark.find({ user: user_id });
    const memoryIds = userBookmarks.map((b) => b.memory);
    if (memoryIds.length === 0) {
      return emptyPaginatedList({ limit, page });
    }
    query = { $and: [filter, { _id: { $in: memoryIds } }] };
    bookmarkedIds = new Set(memoryIds);
  }

  const memories = await Memory.paginate(query, {
    page,
    limit,
    sort: { created_at: -1 },
    populate: [
      {
        path: "attachments",
        select: "-base64",
        match: { provider: { $ne: "s3" } },
      },
      { path: "groups", select: "name description" },
      { path: "beneficiaries", select: "name email relationship" },
    ],
  });

  if (!bookmarked) {
    const memoryIds = memories.docs.map((memory) => memory.id);
    const userBookmarks = await Bookmark.find({
      memory: { $in: memoryIds },
      user: user_id,
    });
    bookmarkedIds = new Set(userBookmarks.map((bookmark) => bookmark.memory));
  }

  return {
    ...memories,
    docs: memories.docs.map((memory) => ({
      ...memory.toObject(),
      bookmarked: bookmarkedIds.has(memory.id),
    })),
  };
}

export async function getMemories(payload: IPagination, user_id: string) {
  const { page, limit, search, bookmarked = false, deleted = false } = payload;
  const filters = filterGenerator({ search }, ["title", "body", "tags"]);

  filters.push({
    user: user_id,
    status: deleted ? "deleted" : { $nin: ["draft", "deleted"] },
  });

  const data = await paginateMemories(
    { $and: filters },
    user_id,
    { page, limit, bookmarked }
  );

  return { data, message: "User memories retrieved successfully" };
}

export async function getConversationMemories(payload: IPagination, user_id: string) {
  const { page, limit, search, bookmarked = false, deleted = false } = payload;

  const filters = filterGenerator({ search }, ["title", "body", "tags"]);

  filters.push({
    user: user_id,
    type: "conversation",
    status: deleted ? "deleted" : { $nin: ["draft", "deleted"] },
  });

  const data = await paginateMemories(
    { $and: filters },
    user_id,
    { page, limit, bookmarked }
  );

  return { data, message: "Conversation memories retrieved successfully" };
}

export async function getStoryMemories(payload: IPagination, user_id: string) {
  const { page, limit, search, bookmarked = false, deleted = false } = payload;

  const filters = filterGenerator({ search }, ["title", "body", "tags"]);
  filters.push({
    user: user_id,
    type: "story",
    status: deleted ? "deleted" : { $nin: ["draft", "deleted"] },
  });

  const data = await paginateMemories(
    { $and: filters },
    user_id,
    { page, limit, bookmarked }
  );

  return { data, message: "Story memories retrieved successfully" };
}

export async function getMemory(_id: string, user_id: string = null) {
  const memory = await Memory
    .findOne({ _id, status: { $nin: ["draft", "deleted"] } })
    .populate({
      path: "attachments",
      select: "-base64",
      match: { provider: { $ne: "s3" } },
    })
    .populate({ path: "groups", select: "name description" })
    .populate({ path: "beneficiaries", select: "name email relationship" })

  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  const bookmark_count = await Bookmark.countDocuments({ memory: memory.id, user: user_id })

  const data = { ...memory.toObject(), bookmarked: bookmark_count > 0 }

  return { data, message: "User memory retrieved successfully" }
}

export async function getMemoryByPrompt(prompt_id: string, user_id: string = null) {
  let memory = null
  memory = await Memory
    .findOne({ prompt: prompt_id, status: { $nin: ["draft", "deleted"] } });

  if (!memory) {
    const prompt = await Prompt.findById(prompt_id)
    if (!prompt) {
      throw new NotFoundException("Memory not found")
    }

    memory = { title: prompt.title }
  }

  return {
    data: memory,
    message: "User memory retrieved successfully"
  }
}

export async function updateMemory(_id: string, payload: Partial<IMemory>, user_id: string) {
  const { status, attachments = [], body, title, tags, level, groups: groupIds, beneficiaries: beneficiaryIds } = payload
  let memory = await Memory.findOne({ _id, user: user_id })
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  let resolvedGroupIds: string[] | undefined
  if (groupIds !== undefined) {
    if (isEmpty(groupIds)) {
      resolvedGroupIds = []
    } else {
      const groups = await Group.find({ _id: { $in: groupIds }, user: user_id })
      resolvedGroupIds = groups.map((g) => g.id)
    }
  }

  let resolvedBeneficiaryIds: string[] | undefined
  if (beneficiaryIds !== undefined) {
    if (isEmpty(beneficiaryIds)) {
      resolvedBeneficiaryIds = []
    } else {
      const beneficiaries = await Beneficiary.find({ _id: { $in: beneficiaryIds }, benefactor: user_id })
      resolvedBeneficiaryIds = beneficiaries.map((b) => b.id)
    }
  }

  const setPayload: Record<string, unknown> = {
    title: title ?? memory?.title,
    body: body ?? memory?.body,
    level: level ?? memory?.level,
    status: status ?? memory?.status,
    tags: tags ?? memory?.tags,
    last_active: dayjs().toDate(),
  }
  if (groupIds !== undefined) {
    setPayload.groups = resolvedGroupIds
  }
  if (beneficiaryIds !== undefined) {
    setPayload.beneficiaries = resolvedBeneficiaryIds
  }

  const updatedMemory = await Memory.findByIdAndUpdate(
    _id,
    {
      $set: setPayload,
      ...(attachments.length > 0 && { $addToSet: { attachments: { $each: attachments } } }),
    },
    { new: true }
  )

  const hasChanges = (updatedMemory?.title && updatedMemory?.title !== memory?.title) ||
    (updatedMemory?.body && updatedMemory?.body !== memory?.body) ||
    (updatedMemory?.status && updatedMemory?.status !== memory?.status);

  if (hasChanges && updatedMemory?.status === MEMORY_STATUS.SAVE) {
    queueStoryInsights(user_id, updatedMemory.id);
    queueSummarization(updatedMemory.id, "story");
  }

  await track({
    title: "Memory Updated",
    description: `Updated memory: "${memory.title}"`,
    type: "memory",
    action: "updated",
    reference: memory.id
  }, user_id)

  return { data: memory, message: "Memory updated successfully" }
}

export async function deleteMemory(payload: IDeleteMemoryPayload, user_id: string) {
  const { memory_id, delete_permanently = false } = payload
  let memory = await Memory.findOne({ _id: memory_id, user: user_id })

  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  if (delete_permanently) {
    // Delete all associated messages
    await Message.deleteMany({ memory: memory.id })

    // Delete all associated bookmarks
    await Bookmark.deleteMany({ memory: memory.id })

    // Mark all associated files as deleted
    if (memory.attachments && memory.attachments.length > 0) {
      await File.updateMany(
        { _id: { $in: memory.attachments } },
        { deleted: true }
      )
    }

    // Delete active prompt if it references this memory
    await ActivePrompt.deleteMany({ memory: memory.id })

    // Permanently delete the memory
    await Memory.findByIdAndDelete(memory.id)
  } else {
    // Soft delete - just mark as deleted
    await memory.updateOne({ status: "deleted" })

    await track({
      title: "Memory Deleted",
      description: `Deleted memory: "${memory.title}"`,
      type: "memory",
      action: "deleted",
      reference: memory.id
    }, user_id)
  }

  return { data: memory, message: "Memory deleted successfully" }
}

export async function restoreMemory(_id: string, user_id: string) {
  let memory = await Memory.findOne({ _id, user: user_id })
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  if (memory.status !== "deleted") {
    throw new BadRequestException("Memory is not deleted")
  }


  // Restore to 'save' status (or you could restore to previous status if you track it)
  await memory.updateOne({ status: "save" })

  await track({
    title: "Memory Restored",
    description: `Restored memory: "${memory.title}"`,
    type: "memory",
    action: "restored",
    reference: memory.id
  }, user_id)

  return { data: memory, message: "Memory restored successfully" }
}

export async function bookmark(memory_id: string, user_id: string) {
  const memory = await Memory.findById(memory_id)
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  let bookmark = await Bookmark.findOne({ memory: memory_id, user: user_id })
  if (!bookmark) {
    bookmark = await Bookmark.create({ memory: memory_id, user: user_id })

    await track({
      title: "Memory Bookmarked",
      description: `Bookmarked memory: "${memory.title}"`,
      type: "memory",
      action: "bookmarked",
      reference: memory_id
    }, user_id)
  }

  return {
    message: "Memory bookmarked successfully",
    data: bookmark
  }
}

export async function unbookmark(memory_id: string, user_id: string) {
  const bookmark = await Bookmark.findOneAndDelete({ memory: memory_id, user: user_id })
  if (!bookmark) {
    throw new NotFoundException("Bookmark not found")
  }

  await track({
    title: "Memory Unbookmarked",
    description: `Unbookmarked memory: "${memory_id}"`,
    type: "memory",
    action: "unbookmarked",
    reference: memory_id
  }, user_id)

  return { data: bookmark, message: "Memory unbookmarked successfully" }
}

export async function removeFileFromMemory(file_id: string, user_id: string) {
  const file = await File.findOne({ _id: file_id, user: user_id })
  if (!file) {
    throw new NotFoundException("File not found")
  }

  const memory = await Memory.findOne({ user: user_id, attachments: file_id })
  if (memory) {
    await memory.updateOne({ $pull: { attachments: file_id } })
  }

  return {
    data: memory,
    message: "File removed and deleted from memory successfully"
  }
}

export async function addMessageToMemory(payload: IAddMessageToMemory, user_id: string) {
  let memory = await Memory.findById(payload.memory_id)
  if (!memory) {
    memory = await Memory.findOne({
      session_id: payload.session_id,
      user: user_id
    })
  }

  if (!memory) {
    memory = await Memory.create({
      user: user_id,
      title: null,
      type: "conversation",
      status: "save",
      session_id: payload.session_id || null
    })
  }

  const messages = []
  const baseTime = dayjs()

  for (let i = 0; i < payload.messages.length; i++) {
    const message = payload.messages[i]
    const createdMessage = await Message.create({
      user: user_id,
      memory: memory?.id,
      role: message.role,
      text: message.text,
      is_voice: message.is_voice || false,
      duration: message.duration || 0,
      created_at: baseTime.add(i, 'second').toDate()
    })
    messages.push(createdMessage)
  }

  if (isEmpty(memory?.title)) {
    const userMessage = messages.find(message => message.role === "user")
    const aiMessage = messages.find(message => message.role === "ai")
    if (userMessage && aiMessage) {
      updateMemoryTitle(memory.id, userMessage.text, aiMessage.text)
    } else {
      memory.updateOne({ title: "Conversation Starts" })
    }
  }

  return {
    data: messages,
    message: "Message added to memory successfully"
  }
}
