import Beneficiary, { IBeneficiary } from "../../model/beneficiary";
import { IPagination } from "../../utils/interface";
import { BadRequestException, NotFoundException } from "../../utils/service-error";

export async function create(payload: IBeneficiary, user: string) {
  const { email, level, name, relationship } = payload

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

  return { message: "Beneficiary added successfully", data }
}

export async function list({ page, limit }: IPagination, user_id: string) {
  const data = await Beneficiary.paginate({ user: user_id }, { page, limit })

  return { message: "Beneficiary retrieved successfully", data }
}

export async function del(id: string, user_id: string) {
  const beneficiary = await Beneficiary.findOne({ _id: id, user: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }
  await beneficiary.deleteOne()

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

  return { message: "Beneficiary updated successfully", data }
}