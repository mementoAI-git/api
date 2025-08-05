import { UploadedFile } from "express-fileupload"
import Memory from "../../database/model/memory"
import File from "../../database/model/file";
import Prompt from "../../database/model/prompt"
import { NotFoundException } from "../../../utils/service-error"
import { IReplyPrompt } from "./interface"
import { isEmpty, processFile, reconstructFileName } from "../../../utils/helpers"
import User from "../../database/model/user";
import ActivePrompt from "../../database/model/active-prompt";
import dayjs from "dayjs";

export const getPrompts = async (user_id: string) => {
  const MAX_PROMPT = 2

  // Get user's active prompts with populated prompt data
  const activePrompts = await ActivePrompt.find({ user: user_id })
    .populate("prompt")

  const answeredMemories = await Memory.find({
    user: user_id,
    prompt: { $exists: true, $ne: null }
  })

  const answeredPromptIds = answeredMemories.map(m => m.prompt)

  if (isEmpty(activePrompts)) {
    await assignNewPromptsToUser(user_id, answeredPromptIds, MAX_PROMPT)
    const newActivePrompts = await ActivePrompt.find({ user: user_id })
      .populate("prompt")

    return {
      data: newActivePrompts,
      message: "New prompts assigned successfully"
    }
  }

  // Process existing active prompts
  const promptsToKeep = []
  const promptsToReplace = []

  for (const activePrompt of activePrompts) {
    const promptId = typeof activePrompt.prompt === 'string'
      ? activePrompt.prompt
      : (activePrompt.prompt as any)._id.toString()
    const isAnswered = answeredMemories.some(m => m.prompt === promptId)
    const isExpired = isAnswered && dayjs().isAfter(dayjs(activePrompt.created_at).add(1, "day").startOf("day"))

    if (isExpired) {
      promptsToReplace.push(activePrompt)
    } else {
      promptsToKeep.push(activePrompt)
    }
  }

  // Replace expired prompts with new ones
  if (promptsToReplace.length > 0) {
    const newPrompts = await getAvailablePrompts(answeredPromptIds, promptsToReplace.length)

    // Delete expired active prompts
    await ActivePrompt.deleteMany({
      _id: { $in: promptsToReplace.map(p => p._id) }
    })

    // Create new active prompts
    if (newPrompts.length > 0) {
      await ActivePrompt.insertMany(
        newPrompts.map(p => ({
          prompt: p._id,
          user: user_id
        }))
      )

      // Get the newly created active prompts with populated data
      const newActivePrompts = await ActivePrompt.find({
        user: user_id,
        prompt: { $in: newPrompts.map(p => p._id) }
      })
        .populate("prompt")

      promptsToKeep.push(...newActivePrompts)
    }
  }

  // If we still don't have enough prompts, add more
  if (promptsToKeep.length < MAX_PROMPT) {
    const remainingSlots = MAX_PROMPT - promptsToKeep.length
    const additionalPrompts = await getAvailablePrompts(answeredPromptIds, remainingSlots)

    if (additionalPrompts.length > 0) {
      await ActivePrompt.insertMany(
        additionalPrompts.map(p => ({
          prompt: p._id,
          user: user_id
        }))
      )

      // Get the newly created active prompts with populated data
      const newActivePrompts = await ActivePrompt.find({
        user: user_id,
        prompt: { $in: additionalPrompts.map(p => p._id) }
      })
        .populate("prompt")

      promptsToKeep.push(...newActivePrompts)
    }
  }

  // If we still don't have enough prompts, reuse some from answered prompts
  if (promptsToKeep.length < MAX_PROMPT) {
    const remainingSlots = MAX_PROMPT - promptsToKeep.length
    const reusablePrompts = await Prompt.find({
      _id: { $in: answeredPromptIds }
    }).limit(remainingSlots)

    // Create active prompts for reusable prompts
    await ActivePrompt.insertMany(
      reusablePrompts.map(p => ({
        prompt: p._id,
        user: user_id
      }))
    )

    // Get the newly created active prompts with populated data
    const newActivePrompts = await ActivePrompt.find({
      user: user_id,
      prompt: { $in: reusablePrompts.map(p => p._id) }
    })
      .populate("prompt")

    promptsToKeep.push(...newActivePrompts)
  }

  return {
    data: promptsToKeep.slice(0, MAX_PROMPT),
    message: "Prompts retrieved successfully"
  }
}

const assignNewPromptsToUser = async (user_id: string, answeredPromptIds: string[], count: number) => {
  const availablePrompts = await getAvailablePrompts(answeredPromptIds, count)

  if (availablePrompts.length > 0) {
    await ActivePrompt.insertMany(
      availablePrompts.map(p => ({
        prompt: p._id,
        user: user_id
      }))
    )
  }
}

const getAvailablePrompts = async (answeredPromptIds: string[], limit: number) => {
  return await Prompt.find({
    _id: { $nin: answeredPromptIds }
  }).limit(limit)
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
    const unsavedFiles = await Promise.all(
      files.map((file) => processFile(file, user_id))
    )

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

  const activePrompt = await ActivePrompt.findOne({ user: user_id, prompt: prompt_id })
  if (activePrompt) {
    await ActivePrompt.findByIdAndUpdate(activePrompt.id, { memory: memory.id })
  } else {
    await ActivePrompt.create({ user: user_id, prompt: prompt_id, memory: memory.id })
  }

  return { data: memory, message: "Response saved successfully" }
} 