import User, { IUser } from "../../model/user";
import { hashPassword } from "../../utils/helpers";
import { NotFoundException } from "../../utils/service-error";
import { ISetPassword } from "./interface";

export async function setPassword(payload: ISetPassword, user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const password = await hashPassword(payload.password)
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

  const data = await User.findByIdAndUpdate(user_id, updatePayload, { new: true }).select("-password -providers")
  return { message: "User profile updated successfully", data }
}