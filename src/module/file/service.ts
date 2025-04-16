import { UploadedFile } from "express-fileupload";
import { reconstructFileName } from "../../utils/helpers";
import User from "../../model/user";
import File from "../../model/file";
import { NotFoundException, UnauthorizedException } from "../../utils/service-error";

export async function uploadFile(payload: UploadedFile[], user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }
  const files = payload.map(file => {
    return {
      name: reconstructFileName(file.name),
      base64: file.data.toString("base64"),
      user: user_id,
      type: file.mimetype
    }
  })

  const data = await File.insertMany(files)

  return { message: "File uploaded successfully", data }
}

export async function getFile(name: string) {
  const file = await File.findOne({ name })
  if (!file) {
    throw new NotFoundException("file not found")
  }

  const buffer = Buffer.from(file.base64, "base64");
  const data = { ...file.toJSON(), buffer }

  return { data, message: "File retrieved successfully" }
}

export async function removeFile(name: string, user_id: string) {
  const file = await File.findOne({ name })
  if (!file) {
    throw new NotFoundException("file not found")
  }
  if (file.user !== user_id) {
    throw new UnauthorizedException()
  }

  await File.deleteOne({ name })
  return { data: file, message: "File deleted successfully" }
}