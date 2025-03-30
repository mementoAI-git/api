import Memory from "../../model/memory";
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
    { user: user_id },
    { page, limit }
  )

  return { data, message: "User memories retrieved successfully" }
}

export async function getMemory(id: string) {
  const data = await Memory.findOne({ $or: [{ _id: id, refrence: id }] })
  return { data, message: "User memory retrieved successfully" }
}

export function updateMemory() {

}