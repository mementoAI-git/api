import bcrypt from "bcrypt"
import dayjs from "dayjs";
import User, { IUser } from "../../database/model/user";
import { hashPassword, isEmpty, reconstructFileName } from "../../../utils/helpers";
import { BadRequestException, NotFoundException } from "../../../utils/service-error";
import { ISetPassword, IVerifyTOTP } from "./interface";
import { UploadedFile } from "express-fileupload";
import File from "../../database/model/file";
import speakeasy from "speakeasy"
import Qr from "qrcode"
import { track } from "../activity/service";

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
    "country",
    "bg_music"
  ])

  const updatePayload = Object.entries(payload).reduce((acc, p) => {
    if (updateableFields.has(p[0])) {
      acc[p[0]] = p[1]
    }
    return acc
  }, {})

  const data = await User
    .findByIdAndUpdate(user_id, updatePayload, { new: true })
    .select("-password -providers -public_key -private_key")

  // Track activity if any fields were updated
  if (Object.keys(updatePayload).length > 0) {
    await track({
      title: "Profile Updated",
      description: `Updated profile: "${Object.keys(updatePayload).join(", ")}"`,
      type: "user",
      action: "updated",
      reference: user_id
    }, user_id)
  }

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

  const { name, mimetype, data, size } = payload[0]

  const file = await File.create({
    name: reconstructFileName(name),
    base64: data.toString("base64"),
    size,
    user: user_id,
    type: mimetype
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