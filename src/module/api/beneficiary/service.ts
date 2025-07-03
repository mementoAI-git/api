import mail from "../../mail";
import { filterGenerator } from "../../../utils/helpers";
import { IPagination } from "../../../utils/interface";
import { BadRequestException, NotFoundException } from "../../../utils/service-error";
import Beneficiary, { IBeneficiary } from "../../database/model/beneficiary";
import { track } from "../activity/service";

export async function create(payload: IBeneficiary, user: string) {
  const { email, level, name = "", relationship = "friend" } = payload

  const beneficiary = await Beneficiary.findOne({ user, email })
  if (beneficiary) {
    throw new BadRequestException("Beneficiary already exist")
  }

  const data = await Beneficiary.create({
    email,
    name,
    relationship,
    level: level || 1,
    user
  })

  if (data) {
    await mail.sendBeneficiaryInvite(email, name)
    await track({
      title: "Beneficiary Invited",
      description: `Invited beneficiary: "${name}"`,
      type: "beneficiary",
      action: "created",
      reference: data.id
    }, user)
  }

  return { message: "Beneficiary added successfully", data }
}

export async function list({ page, limit, ...query }: IPagination, user_id: string) {
  const filters = filterGenerator(query, ["name", "email", "relationship"])
  filters.push({ user: user_id })
  const data = await Beneficiary.paginate(
    { $and: filters },
    { page, limit, sort: { created_at: -1 } }
  )

  return { message: "Beneficiary retrieved successfully", data }
}

export async function del(id: string, user_id: string) {
  const beneficiary = await Beneficiary.findOne({ _id: id, user: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }
  await beneficiary.deleteOne()

  await track({
    title: "Beneficiary Deleted",
    description: `Deleted beneficiary: "${beneficiary.name}"`,
    type: "beneficiary",
    action: "deleted",
    reference: beneficiary.id
  }, user_id)

  return { message: "Beneficiary deleted successfully", data: beneficiary }
}

export async function update(id: string, payload: Partial<IBeneficiary>, user_id: string) {
  const beneficiary = await Beneficiary.findOne({ _id: id, user: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }

  const data = await Beneficiary.findByIdAndUpdate(id, {
    email: payload?.email || beneficiary?.email,
    level: payload?.level || beneficiary?.level
  }, { new: true })

  await track({
    title: "Beneficiary Updated",
    description: `Updated beneficiary: "${beneficiary.name}"`,
    type: "beneficiary",
    action: "updated",
    reference: beneficiary.id
  }, user_id)

  return { message: "Beneficiary updated successfully", data }
}

export async function resendInvite(payload: Pick<IBeneficiary, "email">, user_id: string) {
  const { email } = payload

  const beneficiary = await Beneficiary.findOne({ email, user: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }
  if (beneficiary.status === "accepted") {
    throw new BadRequestException("Beneficiary already accepted")
  }

  await mail.sendBeneficiaryInvite(email, beneficiary.name)
  return { message: "Invite sent successfully", data: beneficiary }
}