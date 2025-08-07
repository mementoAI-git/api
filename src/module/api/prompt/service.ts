import { UploadedFile } from "express-fileupload"
import Memory from "../../database/model/memory"
import File from "../../database/model/file";
import Prompt from "../../database/model/prompt"
import { NotFoundException } from "../../../utils/service-error"
import { IReplyPrompt } from "./interface"
import { isEmpty, processFile } from "../../../utils/helpers"
import User from "../../database/model/user";
import ActivePrompt from "../../database/model/active-prompt";
import dayjs from "dayjs";

export const getPrompts = async (user_id: string) => {
  const MAX_PROMPT = 2

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

    console.log(`[DEBUG] User ${user_id}: Assigned ${newActivePrompts.length} new prompts`)

    return {
      data: newActivePrompts,
      message: "New prompts assigned successfully"
    }
  }

  const promptsToKeep = []
  const promptsToReplace = []

  for (const activePrompt of activePrompts) {
    const promptId = getPromptId(activePrompt)
    const isAnswered = answeredMemories.some(m => m.prompt === promptId)
    const isExpired = isAnswered && dayjs().isAfter(dayjs(activePrompt.created_at).add(1, "day").startOf("day"))

    if (isExpired) {
      promptsToReplace.push(activePrompt)
    } else {
      promptsToKeep.push(activePrompt)
    }
  }

  if (promptsToReplace.length > 0) {
    const keepPromptIds = promptsToKeep.map(p =>
      getPromptId(p)
    )
    const newPrompts = await getAvailablePrompts(answeredPromptIds, promptsToReplace.length, keepPromptIds)

    await ActivePrompt.deleteMany({
      _id: { $in: promptsToReplace.map(p => p._id) }
    })

    if (newPrompts.length > 0) {
      await ActivePrompt.insertMany(
        newPrompts.map(p => ({
          prompt: p._id,
          user: user_id
        }))
      )

      const newActivePrompts = await ActivePrompt.find({
        user: user_id,
        prompt: { $in: newPrompts.map(p => p._id) }
      })
        .populate("prompt")

      promptsToKeep.push(...newActivePrompts)
    }
  }

  if (promptsToKeep.length < MAX_PROMPT) {
    const remainingSlots = MAX_PROMPT - promptsToKeep.length
    const currentActivePromptIds = promptsToKeep.map(p =>
      getPromptId(p)
    )
    const additionalPrompts = await getAvailablePrompts(answeredPromptIds, remainingSlots, currentActivePromptIds)

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

    if (reusablePrompts.length > 0) {
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
  }

  // Final fallback: if we still don't have enough prompts, get any available prompts
  if (promptsToKeep.length < MAX_PROMPT) {
    const remainingSlots = MAX_PROMPT - promptsToKeep.length
    const currentPromptIds = promptsToKeep.map(p => getPromptId(p))

    // Get any prompts that aren't currently active for this user
    const fallbackPrompts = await Prompt.find({
      _id: { $nin: currentPromptIds }
    }).limit(remainingSlots)

    if (fallbackPrompts.length > 0) {
      // Create active prompts for fallback prompts
      await ActivePrompt.insertMany(
        fallbackPrompts.map(p => ({
          prompt: p._id,
          user: user_id
        }))
      )

      // Get the newly created active prompts with populated data
      const newActivePrompts = await ActivePrompt.find({
        user: user_id,
        prompt: { $in: fallbackPrompts.map(p => p._id) }
      })
        .populate("prompt")

      promptsToKeep.push(...newActivePrompts)
    }
  }

  // Ensure no duplicates in final result
  const uniquePrompts = []
  const seenPromptIds = new Set()

  for (const prompt of promptsToKeep) {
    const promptId = getPromptId(prompt)
    if (!seenPromptIds.has(promptId)) {
      seenPromptIds.add(promptId)
      uniquePrompts.push(prompt)
    }
  }

  // Ensure we always return exactly MAX_PROMPT prompts
  let finalPrompts = uniquePrompts.slice(0, MAX_PROMPT)

  // If we still don't have enough prompts, get any available prompts as final fallback
  if (finalPrompts.length < MAX_PROMPT) {
    const remainingSlots = MAX_PROMPT - finalPrompts.length
    const usedPromptIds = finalPrompts.map(p => getPromptId(p))

    // Get any prompts from the database, excluding the ones we already have
    const anyAvailablePrompts = await Prompt.find({
      _id: { $nin: usedPromptIds }
    }).limit(remainingSlots)

    if (anyAvailablePrompts.length > 0) {
      // Create active prompts for these prompts
      await ActivePrompt.insertMany(
        anyAvailablePrompts.map(p => ({
          prompt: p._id,
          user: user_id
        }))
      )

      // Get the newly created active prompts with populated data
      const newActivePrompts = await ActivePrompt.find({
        user: user_id,
        prompt: { $in: anyAvailablePrompts.map(p => p._id) }
      })
        .populate("prompt")

      finalPrompts = [...finalPrompts, ...newActivePrompts].slice(0, MAX_PROMPT)
    }
  }

  return {
    data: finalPrompts,
    message: "Prompts retrieved successfully"
  }
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

const getPromptId = (activePrompt: any): string => {
  return typeof activePrompt.prompt === 'string'
    ? activePrompt.prompt
    : (activePrompt.prompt as any)._id.toString()
}

const getAvailablePrompts = async (answeredPromptIds: string[], limit: number, excludeActivePromptIds: string[] = []) => {
  return await Prompt.find({
    _id: {
      $nin: [...answeredPromptIds, ...excludeActivePromptIds]
    }
  }).limit(limit)
}

const assignNewPromptsToUser = async (user_id: string, answeredPromptIds: string[], count: number) => {
  const availablePrompts = await getAvailablePrompts(answeredPromptIds, count, [])

  if (availablePrompts.length > 0) {
    await ActivePrompt.insertMany(
      availablePrompts.map(p => ({
        prompt: p._id,
        user: user_id
      }))
    )
  }
}