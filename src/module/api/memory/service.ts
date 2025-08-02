import { UploadedFile } from "express-fileupload";
import Memory, { IMemory } from "../../database/model/memory";
import File from "../../database/model/file";
import User from "../../database/model/user";
import { IPagination } from "../../../utils/interface";
import { NotFoundException } from "../../../utils/service-error";
import { ICreateMemoryPayload } from "./interface";
import { emptyPaginatedList, isEmpty, reconstructFileName } from "../../../utils/helpers";
import Bookmark from "../../database/model/bookmarks";
import { track } from "../activity/service";
import { filterGenerator } from "../../../utils/helpers";

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
    const unsavedFiles = files.map(file => {
      return {
        name: reconstructFileName(file.name),
        base64: file.data.toString("base64"),
        size: file.size,
        user: user_id,
        type: file.mimetype
      }
    })

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