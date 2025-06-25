import { UploadedFile } from "express-fileupload";
import Memory, { IMemory } from "../../database/model/memory";
import File from "../../database/model/file";
import User from "../../database/model/user";
import { IPagination } from "../../../utils/interface";
import { NotFoundException } from "../../../utils/service-error";
import { ICreateMemoryPayload } from "./interface";
import { isEmpty, reconstructFileName } from "../../../utils/helpers";

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

  const data = await Memory.paginate(
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

  return { data, message: "User memories retrieved successfully" }
}

export async function getMemory(_id: string) {
  const data = await Memory
    .findOne({ _id, status: { $nin: ["draft", "deleted"] } })
    .populate("attachments", "-base64")

  if (!data) {
    throw new NotFoundException("Memory not found")
  }
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