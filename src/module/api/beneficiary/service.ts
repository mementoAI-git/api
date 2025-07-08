import mail from "../../mail";
import { compareStrings, filterGenerator, isEmpty } from "../../../utils/helpers";
import { IPagination } from "../../../utils/interface";
import { BadRequestException, NotFoundException, UnauthorizedException } from "../../../utils/service-error";
import Beneficiary, { IBeneficiary } from "../../database/model/beneficiary";
import { track } from "../activity/service";
import dayjs from "dayjs";
import { IAcceptInivite } from "./interface";
import User from "../../database/model/user";
import { v4 as uuid } from "uuid";
import AuthCode from "../../database/model/auth-code";

export async function create(payload: IBeneficiary, user_id: string) {
  const { email, level, name = "", relationship = "friend" } = payload

  const benefactor = await User.findOne({ _id: user_id })
  if (!benefactor) {
    throw new UnauthorizedException("benefactor not found")
  }
  if (compareStrings(benefactor.email, email)) {
    throw new BadRequestException("Can't add self as a beneficiary")
  }

  const beneficiary = await Beneficiary.findOne({ benefactor: user_id, email })
  if (beneficiary) {
    throw new BadRequestException("Beneficiary already exist")
  }

  const user = await User.findOne({ email })

  const data = await Beneficiary.create({
    email,
    name,
    relationship,
    level: level || 1,
    due_at: dayjs().add(3, "days").toDate(),
    user: user?.id || null,
    benefactor: user_id
  })

  if (data) {
    await mail.sendBeneficiaryInvite(data)
    await track({
      title: "Beneficiary Invited",
      description: `Invited beneficiary: "${name}"`,
      type: "beneficiary",
      action: "created",
      reference: data.id
    }, user_id)
  }

  return { message: "Beneficiary added successfully", data }
}

export async function list({ page, limit, ...query }: IPagination, user_id: string) {
  const filters = filterGenerator(query, ["name", "email", "relationship"])
  filters.push({ benefactor: user_id })
  const data = await Beneficiary.paginate(
    { $and: filters },
    {
      page,
      limit,
      sort: { created_at: -1 },
      populate: { path: "user", select: "emai first_name last_name picture picture_url" }
    }
  )

  return { message: "Beneficiary retrieved successfully", data }
}

export async function del(id: string, user_id: string) {
  const beneficiary = await Beneficiary.findOne({ _id: id, benefactor: user_id })
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
  const user = await User.findOne({ _id: user_id })
  if (!user) {
    throw new UnauthorizedException("User not found")
  }

  if (!isEmpty(payload?.email)) {
    if (compareStrings(user.email, payload.email)) {
      throw new BadRequestException("Can't add self as a beneficiary")
    }
  }

  const beneficiary = await Beneficiary.findOne({ _id: id, benefactor: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }
  if (beneficiary.status !== "pending") {
    throw new BadRequestException(`Invite has been ${beneficiary.status}`)
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

  const beneficiary = await Beneficiary.findOne({ email, benefactor: user_id })
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found")
  }
  if (beneficiary.status === "accepted") {
    throw new BadRequestException("Beneficiary already accepted")
  }

  await beneficiary.updateOne({ due_at: dayjs().add(3, "days").toDate(), })

  await mail.sendBeneficiaryInvite(beneficiary)
  return { message: "Invite sent successfully", data: beneficiary }
}

export async function getInvite(id: string) {
  const beneficiary = await Beneficiary
    .findById(id)
    .populate("benefactor", "first_name last_name email picture picture_url");
  if (beneficiary.status !== "pending") {
    throw new BadRequestException(`Invite has been ${beneficiary.status}`)
  }
  if (dayjs(beneficiary.due_at).isBefore(dayjs())) {
    throw new BadRequestException("Invite has exipred")
  }

  return { message: "Invite retrieved successfully", data: beneficiary }
}

export async function acceptInvite(payload: IAcceptInivite) {
  const { invite_id, first_name, last_name, dob } = payload

  const beneficiary = await Beneficiary.findById(invite_id)
  if (beneficiary.status !== "pending") {
    throw new BadRequestException(`Invite has been ${beneficiary.status}`)
  }

  const { email } = beneficiary
  let token: string | null = null

  let user = await User.findOne({ email })
  if (isEmpty(user)) {
    user = await User.create({
      first_name,
      last_name,
      dob,
      email
    })

    token = uuid()
    const expires_at = dayjs().add(10, "minutes").toISOString()
    await AuthCode.create({
      code: token,
      email,
      type: "reset",
      expires_at
    })
  }

  beneficiary.user = user.id
  beneficiary.status = "accepted"
  await beneficiary.save()

  return { message: "Invite retrieved successfully", data: { token } }
}