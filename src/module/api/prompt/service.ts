import { UploadedFile } from "express-fileupload"
import Memory from "../../database/model/memory"
import File from "../../database/model/file";
import Prompt from "../../database/model/prompt"
import { NotFoundException } from "../../../utils/service-error"
import { IReplyPrompt } from "./interface"
import { isEmpty, reconstructFileName } from "../../../utils/helpers"
import User from "../../database/model/user";
import ActivePrompt from "../../database/model/active-prompt";
import dayjs from "dayjs";

export const getPrompts = async (user_id: string) => {
  const MAX_PROMPT = 2
  let result = []
  const activePrompts = await ActivePrompt.find({ user: user_id }).populate("prompt")

  const memories = await Memory.find({
    user: user_id,
    prompt: { $exists: true }
  })
  const prompt_ids = memories.map(m => m.prompt)
  if (isEmpty(activePrompts)) {
    let prompts = await Prompt.find({ _id: { $nin: prompt_ids } }).limit(MAX_PROMPT);
    if (isEmpty(prompts)) {
      prompts = await Prompt.find().limit(MAX_PROMPT);
    }

    await ActivePrompt.insertMany(
      prompts.map(p => ({
        prompt: p._id,
        user: user_id
      }))
    );
    result = prompts
  } else {
    const expiredPrompts = [];

    activePrompts.forEach(prompt => {
      const has_exipred = dayjs().isAfter(dayjs(prompt.created_at).add(1, "day").startOf("day"))
      const exists = memories.some(m => m.prompt === prompt.prompt);

      if (has_exipred && exists) {
        expiredPrompts.push(prompt.prompt)
      } else {
        result.push(prompt.prompt)
      }
    });

    if (result.length < MAX_PROMPT) {
      const slot_left = Math.min(Math.abs(MAX_PROMPT - result.length), MAX_PROMPT)
      const newPrompts = await Prompt
        .find({ _id: { $nin: prompt_ids } })
        .limit(slot_left);

      newPrompts.forEach(result.push)

      if (!isEmpty(expiredPrompts) && result.length >= MAX_PROMPT) {
        await ActivePrompt.deleteMany({
          prompt: { $in: expiredPrompts.map(p => p._id) }
        })
      }
    }

    if (result.length < MAX_PROMPT) {
      const slot_left = Math.min(Math.abs(MAX_PROMPT - result.length), MAX_PROMPT)
      activePrompts
        .slice(0, slot_left)
        .forEach(p => result.push(p.prompt))
    }
  }
  return { data: result, message: "Prompts retrieved successfully" }
}

export const getUserPromptResponse = async (id: string, user_id: string) => {
  let memory = await Memory
    .findOne({ user: user_id, prompt: id })
    .populate({ path: "attachments", select: "-base64" });

  if (!memory) {
    const prompt = await Prompt.findById(id)
    if (!prompt) {
      throw new NotFoundException("Prompt not found")
    }
    memory = await Memory.create({
      user: user_id,
      status: "draft",
      title: prompt.title,
      prompt: id
    })
  }

  return { data: memory, message: "User prompt response retrieved successfully" }
}

export const replyPrompt = async (payload: IReplyPrompt, user_id: string, files: UploadedFile[] | null = null) => {
  const { prompt_id, body, tags = [], level = 1 } = payload;

  const user = await User.findById(user_id)
  if (isEmpty(user)) {
    throw new NotFoundException("User not found")
  }

  const prompt = await Prompt.findById(prompt_id)
  if (!prompt) {
    throw new NotFoundException("Prompt not found")
  }

  let attachments = payload?.attachments || []
  if (!isEmpty(files)) {
    const unsavedFiles = files.map(file => {
      return {
        name: reconstructFileName(file.name),
        base64: file.data.toString("base64"),
        size: file.size,
        user: user_id,
        type: file.mimetype
      }
    })

    const savedFiles = await File.insertMany(unsavedFiles)
    attachments = [...attachments, ...savedFiles.map(f => f.id)]
  }

  let memory = await Memory.findOne({ user: user_id, prompt: prompt_id })
  if (!memory) {
    memory = await Memory.create({
      user: user_id,
      title: prompt?.title,
      prompt: prompt_id,
      body,
      level,
      tags,
      attachments
    })
  } else {
    memory = await Memory.findByIdAndUpdate(
      memory.id,
      {
        body: body || memory?.body,
        level,
        tags,
        $addToSet: { attachments: { $each: attachments } }
      },
      { new: true }
    )
  }

  return { data: memory, message: "Response saved successfully" }
} 