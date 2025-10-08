import { UploadedFile } from "express-fileupload";
import dayjs from "dayjs";
import Memory, { IMemory } from "../../database/model/memory";
import File from "../../database/model/file";
import User from "../../database/model/user";
import { IPagination } from "../../../utils/interface";
import { BadRequestException, NotFoundException } from "../../../utils/service-error";
import { IAddMessageToMemory, ICreateMemoryPayload } from "./interface";
import { emptyPaginatedList, isEmpty, processFile } from "../../../utils/helpers";
import Bookmark from "../../database/model/bookmarks";
import { track } from "../activity/service";
import { filterGenerator } from "../../../utils/helpers";
import Prompt from "../../database/model/prompt";
import { updateStreak } from "../user/service";
import Message from "../../database/model/message";
import { updateMemoryTitle } from "../ai/utils";

export async function memoryStats(user_id: string) {
  const memory_count = await Memory.countDocuments({
    user: user_id,
    status: { $nin: ["draft", "deleted"] }
  })
  const bookmark_count = await Bookmark.countDocuments({ user: user_id })
  const data = { memory_count, bookmark_count }

  return {
    data,
    message: "Memory stats retrieved successfully"
  }
}

export async function createMemory(payload: ICreateMemoryPayload, user_id: string, files: UploadedFile[] | null = null) {
  const { title, body, status, tags = [], level = 1 } = payload
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  let attachments = payload?.attachments || []
  if (!isEmpty(files)) {
    const unsavedFiles = await Promise.all(
      files.map((file) => processFile(file, user_id))
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
    attachments
  })

  // Track activity
  await track({
    title: "Memory Created",
    description: `Created memory: "${title}"`,
    type: "memory",
    action: "created",
    reference: memory.id
  }, user_id)

  updateStreak(user_id)

  return {
    message: "Memory created successfully",
    data: memory
  }
}

export async function getMemories(payload: IPagination, user_id: string) {
  const { page, limit, search = "", bookmarked = false, deleted = false } = payload
  const filters = filterGenerator({ search }, ["title", "body", "tags"])

  if (deleted) {
    filters.push({
      user: user_id,
      status: "deleted"
    })
  } else {
    filters.push({
      user: user_id,
      status: { $nin: ["draft", "deleted"] }
    })
  }

  let memoryQuery = { $and: filters }

  // If filtering by bookmarked, get only bookmarked memory IDs for the user
  let bookmarkedIds: Set<string> = new Set()
  if (bookmarked) {
    const userBookmarks = await Bookmark.find({ user: user_id })
    const memoryIds = userBookmarks.map(b => b.memory)
    if (memoryIds.length === 0) {

      return {
        data: emptyPaginatedList({ limit, page }),
        message: "User memories retrieved successfully"
      }
    }
    memoryQuery = { $and: [...filters, { _id: { $in: memoryIds } }] }
    bookmarkedIds = new Set(memoryIds)
  }

  const memories = await Memory.paginate(
    memoryQuery,
    {
      page,
      limit,
      sort: { created_at: -1 },
      populate: { path: "attachments", select: "-base64" }
    }
  )

  // If not filtering by bookmarked, get bookmarks for the current page
  if (!bookmarked) {
    const memoryIds = memories.docs.map(memory => memory.id)
    const userBookmarks = await Bookmark.find({
      memory: { $in: memoryIds },
      user: user_id
    })
    bookmarkedIds = new Set(userBookmarks.map(bookmark => bookmark.memory))
  }

  const data = {
    ...memories,
    docs: memories.docs.map(memory => ({
      ...memory.toObject(),
      bookmarked: bookmarkedIds.has(memory.id)
    }))
  }

  return { data, message: "User memories retrieved successfully" }
}

export async function getConversationMemories(payload: IPagination, user_id: string) {
  const { page, limit, search = "", bookmarked = false, deleted = false } = payload
  const filters = filterGenerator({ search }, ["title", "body", "tags"])

  filters.push({
    user: user_id,
    type: "conversation",
    status: deleted ? "deleted" : { $nin: ["draft", "deleted"] }
  })

  let memoryQuery = { $and: filters }

  // If filtering by bookmarked, get only bookmarked memory IDs for the user
  let bookmarkedIds: Set<string> = new Set()
  if (bookmarked) {
    const userBookmarks = await Bookmark.find({ user: user_id })
    const memoryIds = userBookmarks.map(b => b.memory)
    if (memoryIds.length === 0) {
      return {
        data: emptyPaginatedList({ limit, page }),
        message: "Conversation memories retrieved successfully"
      }
    }
    memoryQuery = { $and: [...filters, { _id: { $in: memoryIds } }] }
    bookmarkedIds = new Set(memoryIds)
  }

  const memories = await Memory.paginate(
    memoryQuery,
    {
      page,
      limit,
      sort: { created_at: -1 },
      populate: { path: "attachments", select: "-base64" }
    }
  )

  // If not filtering by bookmarked, get bookmarks for the current page
  if (!bookmarked) {
    const memoryIds = memories.docs.map(memory => memory.id)
    const userBookmarks = await Bookmark.find({
      memory: { $in: memoryIds },
      user: user_id
    })
    bookmarkedIds = new Set(userBookmarks.map(bookmark => bookmark.memory))
  }

  const data = {
    ...memories,
    docs: memories.docs.map(memory => ({
      ...memory.toObject(),
      bookmarked: bookmarkedIds.has(memory.id)
    }))
  }

  return { data, message: "Conversation memories retrieved successfully" }
}

export async function getStoryMemories(payload: IPagination, user_id: string) {
  const { page, limit, search = "", bookmarked = false, deleted = false } = payload
  const filters = filterGenerator({ search }, ["title", "body", "tags"])

  filters.push({
    user: user_id,
    type: "story",
    status: deleted ? "deleted" : { $nin: ["draft", "deleted"] }
  })

  let memoryQuery = { $and: filters }

  // If filtering by bookmarked, get only bookmarked memory IDs for the user
  let bookmarkedIds: Set<string> = new Set()
  if (bookmarked) {
    const userBookmarks = await Bookmark.find({ user: user_id })
    const memoryIds = userBookmarks.map(b => b.memory)
    if (memoryIds.length === 0) {
      return {
        data: emptyPaginatedList({ limit, page }),
        message: "Story memories retrieved successfully"
      }
    }
    memoryQuery = { $and: [...filters, { _id: { $in: memoryIds } }] }
    bookmarkedIds = new Set(memoryIds)
  }

  const memories = await Memory.paginate(
    memoryQuery,
    {
      page,
      limit,
      sort: { created_at: -1 },
      populate: { path: "attachments", select: "-base64" }
    }
  )

  // If not filtering by bookmarked, get bookmarks for the current page
  if (!bookmarked) {
    const memoryIds = memories.docs.map(memory => memory.id)
    const userBookmarks = await Bookmark.find({
      memory: { $in: memoryIds },
      user: user_id
    })
    bookmarkedIds = new Set(userBookmarks.map(bookmark => bookmark.memory))
  }

  const data = {
    ...memories,
    docs: memories.docs.map(memory => ({
      ...memory.toObject(),
      bookmarked: bookmarkedIds.has(memory.id)
    }))
  }

  return { data, message: "Story memories retrieved successfully" }
}

export async function getMemory(_id: string, user_id: string = null) {
  const memory = await Memory
    .findOne({ _id, status: { $nin: ["draft", "deleted"] } })
    .populate("attachments", "-base64")

  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  const bookmark = await Bookmark.findOne({ memory: memory.id, user: user_id })

  const data = { ...memory.toObject(), bookmarked: !isEmpty(bookmark) }

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
  const { status, attachments = [], body, title, tags, level } = payload
  let memory = await Memory.findOne({ _id, user: user_id })
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  memory = await Memory.findByIdAndUpdate(
    _id,
    {
      title: title || memory?.title,
      body: body || memory?.body,
      level: level || memory?.level,
      status,
      tags,
      $addToSet: { attachments: { $each: attachments } }
    },
    { new: true }
  )

  await track({
    title: "Memory Updated",
    description: `Updated memory: "${memory.title}"`,
    type: "memory",
    action: "updated",
    reference: memory.id
  }, user_id)

  return { data: memory, message: "Memory updated successfully" }
}

export async function deleteMemory(_id: string, user_id: string) {
  let memory = await Memory.findOne({ _id, user: user_id })
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  await memory.updateOne({ status: "deleted" })

  await track({
    title: "Memory Deleted",
    description: `Deleted memory: "${memory.title}"`,
    type: "memory",
    action: "deleted",
    reference: memory.id
  }, user_id)

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
  console.log(memory)
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
    memory = await Memory.create({
      user: user_id,
      title: null,
      type: "conversation",
      status: "save",
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