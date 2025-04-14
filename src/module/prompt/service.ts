import { UploadedFile } from "express-fileupload"
import Memory from "../../model/memory"
import File from "../../model/file";
import Prompt from "../../model/prompt"
import { NotFoundException } from "../../utils/service-error"
import { IReplyPrompt } from "./interface"
import { isEmpty, reconstructFileName } from "../../utils/helpers"
import User from "../../model/user";

export const getPrompts = async () => {
  const data = await Prompt.find()

  return { data, message: "Prompts retrieved successfully" }
}

export const getUserPromptResponse = async (id: string, user_id: string) => {
  const memory = await Memory.findOne({ user: user_id, prompt: id })
  if (!memory) {
    throw new NotFoundException("No response to prompt")
  }

  return { data: memory, message: "User prompt response retrieved successfully" }
}

export const replyPrompt = async (payload: IReplyPrompt, user_id: string, files: UploadedFile[] | null = null) => {
  const { prompt_id, text: body } = payload;

  const user = await User.findById(user_id)
  if (isEmpty(user)) {
    throw new NotFoundException("User not found")
  }

  const prompt = await Prompt.findById(prompt_id)
  if (!prompt) {
    throw new NotFoundException("Prompt not found")
  }

  let attachments = []
  if (!isEmpty(files)) {
    const unsavedFiles = files.map(file => {
      return {
        name: reconstructFileName(file.name),
        base64: file.data.toString("base64"),
        user: user_id,
        type: file.mimetype
      }
    })

    const savedFiles = await File.insertMany(unsavedFiles)
    attachments = savedFiles.map(f => f.id)
  }

  let memory = await Memory.findOne({ user: user_id, prompt: prompt_id })
  if (!memory) {
    memory = await Memory.create({
      user: user_id,
      title: prompt?.title,
      body,
      prompt: prompt_id,
      attachments
    })
  } else {
    memory = await Memory.findByIdAndUpdate(
      memory.id,
      {
        body: body || memory?.body,
        $addToSet: { attachments: { $each: attachments } }
      },
      { new: true }
    )
  }

  return { data: memory, message: "Response saved successfully" }
} 