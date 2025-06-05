import dayjs from "dayjs";
import Beneficiary from "../../model/beneficiary";
import Capsule from "../../model/capsule";
import { isEmpty } from "../../utils/helpers";
import { IPagination } from "../../utils/interface";
import { NotFoundException } from "../../utils/service-error";
import { ICreateCapsulePayload } from "./interface";

export async function createCapsule(payload: ICreateCapsulePayload, user_id: string) {
  const users = await Beneficiary.find({ email: { $in: payload.recipients }, user: user_id })
  if (isEmpty(users)) {
    throw new NotFoundException("Users not found")
  }

  const data = await Capsule.create({
    ...payload,
    recipients: users.map(u => u.id),
    delivery_date: dayjs(payload.delivery_date).toISOString()
  })

  return { message: "Capsule created successfully", data }
}
export function updateCapsule() { }

export async function getCapsules({ page, limit }: IPagination, user: string) {
  const data = await Capsule.paginate(
    { user },
    { limit, page, sort: { created_at: -1 } }
  )

  return { message: "Time capsules retrieved successfully", data }
}

export async function getCapsule(id: string, user: string) {
  const capsule = await Capsule.findOne({ user, _id: id })
  if (!capsule) {
    throw new NotFoundException("Capsule not found")
  }

  return { message: "Time capsule retrieved successfully", data: capsule }
}

export async function deleteCapsule(id: string, user: string) {
  const capsule = await Capsule.findOne({ user, _id: id })
  if (!capsule) {
    throw new NotFoundException("Capsule not found")
  }

  await capsule.deleteOne()
  return { message: "Time capsule deleted successfully", data: capsule }
}