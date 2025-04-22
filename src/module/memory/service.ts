import Memory, { IMemory } from "../../model/memory";
import User from "../../model/user";
import { IPagination } from "../../utils/interface";
import { NotFoundException } from "../../utils/service-error";
import { ICreateMemoryPayload } from "./interface";

export async function createMemory(payload: ICreateMemoryPayload, user_id: string) {
  const { title, body, tags = [], attachments = [] } = payload
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const memory = await Memory.create({
    title,
    body,
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
    { user: user_id, status: { $ne: "draft" } },
    {
      page,
      limit,
      populate: { path: "attachments", select: "-base64" }
    }
  )

  return { data, message: "User memories retrieved successfully" }
}

export async function getMemory(id: string) {
  const data = await Memory.findOne({ _id: id }).populate("attachments", "-base64")
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