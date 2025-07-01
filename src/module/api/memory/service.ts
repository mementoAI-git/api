import { UploadedFile } from "express-fileupload";
import Memory, { IMemory } from "../../database/model/memory";
import File from "../../database/model/file";
import User from "../../database/model/user";
import { IPagination } from "../../../utils/interface";
import { NotFoundException } from "../../../utils/service-error";
import { ICreateMemoryPayload } from "./interface";
import { isEmpty, reconstructFileName } from "../../../utils/helpers";
import Bookmark from "../../database/model/bookmarks";

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
  const { title, body, tags = [], level = 1 } = payload
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
    status: "save",
    tags,
    attachments
  })

  return {
    message: "Memory created successfully",
    data: memory
  }
}

export async function getMemories(payload: IPagination, user_id: string) {
  const { page, limit } = payload

  const memories = await Memory.paginate(
    {
      user: user_id,
      status: { $nin: ["draft", "deleted"] }
    },
    {
      page,
      limit,
      populate: { path: "attachments", select: "-base64" }
    }
  )

  const memoryIds = memories.docs.map(memory => memory.id)
  const userBookmarks = await Bookmark.find({
    memory: { $in: memoryIds },
    user: user_id
  })

  const bookmarkedIds = new Set(userBookmarks.map(bookmark => bookmark.memory))

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
  const { status, attachments = [], body, tags, level } = payload
  let memory = await Memory.findOne({ _id, user: user_id })
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  memory = await Memory.findByIdAndUpdate(
    _id,
    {
      body: body || memory?.body,
      level: level || memory?.level,
      status,
      tags,
      $addToSet: { attachments: { $each: attachments } }
    },
    { new: true }
  )

  return { data: memory, message: "Memory updated successfully" }
}

export async function deleteMemory(_id: string, user_id: string) {
  let memory = await Memory.findOne({ _id, user: user_id })
  if (!memory) {
    throw new NotFoundException("Memory not found")
  }

  await memory.updateOne({ status: "deleted" })

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

  return { data: bookmark, message: "Memory unbookmarked successfully" }
}