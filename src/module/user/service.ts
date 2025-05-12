import bcrypt from "bcrypt"
import dayjs from "dayjs";
import User, { IUser } from "../../model/user";
import { hashPassword, reconstructFileName } from "../../utils/helpers";
import { BadRequestException, NotFoundException } from "../../utils/service-error";
import { ISetPassword } from "./interface";
import { UploadedFile } from "express-fileupload";
import File from "../../model/file";

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
  const user = await User.findById(user_id).select("-password -providers")
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
    "country"
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

  const { name, mimetype, data } = payload[0]

  const file = await File.create({
    name: reconstructFileName(name),
    base64: data.toString("base64"),
    user: user_id,
    type: mimetype
  })

  if (user.picture) {
    await File.deleteOne({ name: user.picture })
  }

  await user.updateOne({ picture: file.name })

  return { message: "Profile pics uploaded successfully", data: file }
}