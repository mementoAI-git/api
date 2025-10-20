import bcrypt from "bcrypt"
import dayjs from "dayjs";
import User, { IUser } from "../../database/model/user";
import { hashPassword, isEmpty, processFile, reconstructFileName } from "../../../utils/helpers";
import { BadRequestException, NotFoundException } from "../../../utils/service-error";
import { ICompleteOnboardingPayload, ISetPassword, IUpdateContext, IVerifyTOTP } from "./interface";
import { UploadedFile } from "express-fileupload";
import File from "../../database/model/file";
import speakeasy from "speakeasy"
import Qr from "qrcode"

export async function setPassword(payload: ISetPassword, user_id: string) {
  const { new_password, old_password } = payload
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  let is_match = await bcrypt.compare(old_password, `${user?.password}`)
  if (!is_match) {
    throw new BadRequestException("Incorrect password")
  }

  const password = await hashPassword(new_password)
  await user.updateOne({ password })

  return { message: "Password updated successfully", data: null }
}

export async function getProfile(user_id: string) {
  const user = await User.findById(user_id).select("-password -providers -two_factor.secret")
  if (!user) {
    throw new NotFoundException("User not found", null)
  }

  return { message: "User profile retrieved successfully", data: user }
}

export async function updateProfile(payload: Partial<IUser>, user_id: string) {
  const user = await User.findById(user_id).select("-password -providers")
  if (!user) {
    throw new NotFoundException("User not found", null)
  }
  const updateableFields = new Set([
    "first_name",
    "last_name",
    "phone_number",
    "gender",
    "dob",
    "nickname",
    "country",
    "bg_music",
    "chat_voice"
  ])

  const updatePayload = Object.entries(payload).reduce((acc, p) => {
    if (updateableFields.has(p[0])) {
      acc[p[0]] = p[1]
    }
    return acc
  }, {})

  // Handle onboarding fields nested under context only
  const selfDescription = (payload as any)?.context?.self_description
  const currentPriority = (payload as any)?.context?.current_priority
  if (!isEmpty(selfDescription)) {
    (updatePayload as any)["context.self_description"] = selfDescription
  }
  if (!isEmpty(currentPriority)) {
    (updatePayload as any)["context.current_priority"] = currentPriority
  }

  const data = await User
    .findByIdAndUpdate(user_id, updatePayload, { new: true })
    .select("-password -providers -public_key -private_key")


  return { message: "User profile updated successfully", data }
}

export async function updateStreak(user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const today = dayjs().format("YYYY-MM-DD")

  if (user.last_seen !== today) {
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD")

    if (user.last_seen === yesterday) {
      user.streak += 1
    } else user.streak = 1;

    user.last_seen = today
    await user.save()
  }

  const data = {
    last_seen: user.last_seen,
    streak: user.streak
  }
  return { message: "Streak updated successfully", data }
}

export async function uploadPicture(payload: UploadedFile[], user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const { name, type, size } = await processFile(payload[0], user_id)
  // const { name, mimetype, data, size } = processedFile

  const file = await File.create({
    name,
    // base64: data.toString("base64"),
    size,
    user: user_id,
    type
  })

  if (user.picture) {
    await File.deleteOne({ name: user.picture })
  }

  await user.updateOne({ picture: file.name })

  return { message: "Profile pics uploaded successfully", data: file }
}

export async function setup2FA(user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const secret = speakeasy.generateSecret({
    name: `Memento (${user.email})`,
  });

  await user.updateOne({ "two_factor.secret": secret.base32 })
  const qrcode = await Qr.toDataURL(secret.otpauth_url)

  return {
    data: { url: secret.otpauth_url, qrcode, secret: secret.base32 },
    message: "2FA setup successful. Scan the QR code with your Authenticator app."
  }
}

//verify time-base one-time-password
export async function verifyTOTP({ token }: IVerifyTOTP, user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }
  if (isEmpty(user?.two_factor?.secret)) {
    throw new BadRequestException("Token verification failed. You must set up 2FA before verifying.")
  }

  const verified = speakeasy.totp.verify({
    secret: user.two_factor.secret,
    encoding: 'base32',
    token
  });

  if (!verified) {
    throw new BadRequestException("Invalid token", { verified })
  }

  if (!user?.two_factor?.enabled) {
    await user.updateOne({ "two_factor.enabled": true })
  }

  return { data: { verified }, message: "Verification successful" }
}

export async function disable2FA(user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  await user.updateOne({
    two_factor: {
      enabled: false,
      secret: null
    }
  })

  return { data: null, message: "2FA disabled successfully" }
}

export async function completeOnboarding(user_id: string, payload?: ICompleteOnboardingPayload) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const updateDoc: any = { onbaorded: true }
  if (payload) {
    if (!isEmpty(payload?.self_description)) {
      updateDoc["context.self_description"] = payload.self_description
    }
    if (!isEmpty(payload?.current_priority)) {
      updateDoc["context.current_priority"] = payload.current_priority
    }
    if (!isEmpty(payload?.dob)) {
      updateDoc["dob"] = payload.dob
    }
    if (Array.isArray(payload?.join_reasons) && payload.join_reasons.length > 0) {
      updateDoc["context.join_reasons"] = payload.join_reasons
    }
  }

  await user.updateOne(updateDoc)

  return { data: null, message: "Onboarding completed successfully" }
}

export async function updateContext(payload: IUpdateContext, user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const allowed: Array<keyof IUpdateContext> = [
    "important_notes",
    "key_preferences",
    "conversation_history_summary",
    "emotional_state_trends",
    "goals_and_aspirations",
    "self_description",
    "current_priority",
    "join_reasons"
  ]

  const updateDoc: Record<string, unknown> = {}
  for (const key of allowed) {
    const value = (payload as any)[key]
    if (!isEmpty(value)) {
      updateDoc[`context.${key}`] = value
    }
  }

  if (Object.keys(updateDoc).length === 0) {
    return { message: "Nothing to update", data: await User.findById(user_id).select("-password -providers -two_factor.secret") }
  }

  const data = await User
    .findByIdAndUpdate(user_id, updateDoc, { new: true })
    .select("-password -providers -public_key -private_key")

  return { message: "User context updated successfully", data }
}