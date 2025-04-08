import Beneficiary, { IBeneficiary } from "../../model/beneficiary";
import { BadRequestException, NotFoundException } from "../../utils/service-error";

export async function create(payload: IBeneficiary, user: string) {
  const { email, level } = payload

  const beneficiary = await Beneficiary.findOne({ user, email })
  if (beneficiary) {
    throw new BadRequestException("Beneficiary already exist")
  }

  const data = await Beneficiary.create({
    email,
    level: level || 1,
    user
  })

  return { message: "Beneficiary added successfully", data }
}

export async function list(user_id: string) {
  const data = await Beneficiary.find({ user: user_id })

  return { message: "Beneficiary retrieved successfully", data }
}

export async function del(id: string, user_id: string) {
  await Beneficiary.deleteOne({ $or: [{ email: id, _id: id }], user: user_id })

  return { message: "Beneficiary deleted successfully", data: null }
}

export async function update(id: string, payload: Partial<IBeneficiary>, user_id: string) {
  const beneficiary = await Beneficiary.findOne({ _id: id, user: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }

  await beneficiary.updateOne({
    email: payload?.email || beneficiary?.email,
    level: payload?.level || beneficiary?.level
  })

  return { message: "Beneficiary updated successfully", data: null }
}