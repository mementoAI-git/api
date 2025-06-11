import dayjs from "dayjs";
import Beneficiary from "../../model/beneficiary";
import Capsule, { ICapsule } from "../../model/capsule";
import { isEmpty } from "../../utils/helpers";
import { IPagination } from "../../utils/interface";
import { NotFoundException } from "../../utils/service-error";

export async function createCapsule(payload: ICapsule, user_id: string) {
  const users = await Beneficiary.find({ email: { $in: payload.recipients }, user: user_id })
  if (isEmpty(users)) {
    throw new NotFoundException("Users not found")
  }
  const data = await Capsule.create({
    ...payload,
    user: user_id,
    recipients: users.map(u => u.id),
    delivery_date: dayjs(payload.delivery_date).toISOString()
  })

  return { message: "Capsule created successfully", data }
}
export async function updateCapsule(id: string, payload: Partial<ICapsule>, user_id: string) {
  const capsule = await Capsule.findOne({ _id: id, user: user_id })
  if (!capsule) {
    throw new NotFoundException("Capsule not found")
  }

  if (payload.recipients && payload.recipients.length > 0) {
    const users = await Beneficiary.find({ email: { $in: payload.recipients }, user: user_id })
    if (isEmpty(users)) {
      throw new NotFoundException("Recipients not found")
    }
    payload.recipients = users.map(u => u.id)
  }

  if (payload.delivery_date) {
    payload.delivery_date = dayjs(payload.delivery_date).toISOString()
  }
  Object.assign(capsule, payload)
  await capsule.save()

  return { message: "Capsule updated successfully", data: capsule }
}

export async function getCapsules({ page, limit }: IPagination, user: string) {
  const data = await Capsule.paginate(
    { user },
    {
      limit,
      page,
      sort: { created_at: -1 },
      populate: { path: "recipients", select: "email first_name last_name" }
    }
  )

  return { message: "Time capsules retrieved successfully", data }
}

export async function getCapsule(id: string, user: string) {
  const capsule = await Capsule.findOne({ user, _id: id })
    .populate([
      { path: "recipients", select: "email first_name last_name" },
      { path: "attachments", select: "-base64" }
    ])
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