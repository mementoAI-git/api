import { Response } from "express";
import { FilterQuery } from "mongoose";
import { createUserContent, GenerateContentResponse, Modality, PartListUnion } from "@google/genai";
import Message, { IMessage } from "../../database/model/message";
import gemini, { GEMINI_MODEL } from "../../../services/gemini";
import { geminiAuthClient, GEMINI_LIVE_MODEL } from "../../../services/gemini";
import { extractJson, isEmpty } from "../../../utils/helpers";
import { IPagination } from "../../../utils/interface";
import { IPrompt, IStartMemory, ITranscribeAudio } from "./interface";
import File, { ITranscriptionData } from "../../database/model/file"
import { NotFoundException } from "../../../utils/service-error";
import User from "../../database/model/user";
import dayjs from "dayjs";
import {
  createSystemContext,
  createSystemContextWithPrompt,
} from "./utils/prompts";
import { createTranscriptionPrompt } from './utils/prompts';
import Memory from "../../database/model/memory";
import {
  triggerSummarization,
  createChatHistory,
  isSignificantMessage,
  processFile,
  processFiles,
  updateMemoryTitle
} from "./utils";
import Prompt from "../../database/model/prompt";
import { updateStreak } from "../user/service";
import { addToInsightsBuffer } from "../../../services/queues/insights";

export async function prompt(payload: IPrompt & { memory: string }, user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  let messages = await Message.find({
    user: user_id,
    memory: payload.memory
  })
    .sort({ created_at: -1 })
    .limit(25)

  messages = messages.reverse()

  let content: PartListUnion = [payload.text]

  const systemInstruction = await createSystemContext(user, payload.memory);

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    config: { systemInstruction },
    history: createChatHistory(messages)
  });

  if (!isEmpty(payload?.attachments)) {
    const result = await processFiles(payload.attachments)
    content = [...content, ...result]
  }

  const response = await chat.sendMessageStream({ message: content });

  await Message.create({
    user: user_id,
    memory: payload.memory,
    role: 'user',
    attatchments: payload?.attachments || [],
    text: payload?.text
  })

  return response
}

export async function handleStreaming(user: string, memory: string, payload: AsyncGenerator<GenerateContentResponse, any, any>, res: Response) {
  let text = ""
  let userMessage = "" // Store the user's message

  try {
    // Get the user's last message for analysis
    const lastUserMessage = await Message.findOne({
      user,
      memory,
      role: 'user'
    }).sort({ created_at: -1 });

    if (lastUserMessage) {
      userMessage = lastUserMessage.text;
    }

    for await (const chunk of payload) {
      if (chunk.text) {
        text += chunk.text;
        res.write(chunk.text);
      }
    }
  } catch (error) {
    res.write(`ERROR: ${error?.message}`);
  } finally {
    if (!isEmpty(text)) {
      await Message.create({
        text,
        user,
        memory,
        role: "ai"
      });

      // Update message count and last_active for summarization tracking
      await Memory.findByIdAndUpdate(memory, {
        $inc: { message_count: 2 },
        $set: { last_active: dayjs().toDate() }
      });

      if (userMessage && isSignificantMessage(userMessage)) {
        addToInsightsBuffer(user, memory, userMessage, text).catch(error => {
          console.error('Error queueing insights extraction:', error);
        });
      }

      triggerSummarization(memory)
    }
    res.end();
  }
}

export async function getUserMessages({ limit, ...query }: IPagination & { next?: string }, user: string) {
  const filter: FilterQuery<IMessage> = { user }
  const fetch_limit = limit + 1;

  if (!isEmpty(query?.next)) {
    const message = await Message.findById(query?.next)
    if (message) {
      filter.created_at = { $lte: message.created_at };
    }
  }

  const messages = await Message.find(filter)
    .sort({ created_at: -1 })
    .populate("attatchments", "-base64")
    .limit(fetch_limit)

  let next = null;
  let messagesToSend = messages;

  if (messages.length === fetch_limit) {
    next = messages[limit]?.id || null;
    messagesToSend = messages.slice(0, limit);
  }

  const data = { messages: messagesToSend.reverse(), next }
  return { message: "User messages retrieved successfully", data }
}

export async function getUserMessagesByConversation(id: string, { limit, ...query }: IPagination & { next?: string }, user: string) {
  const filter: FilterQuery<IMessage> = { user, memory: id }
  const fetch_limit = limit + 1;

  if (!isEmpty(query?.next)) {
    const message = await Message.findById(query?.next)
    if (message) {
      filter.created_at = { $lte: message.created_at };
    }
  }

  const messages = await Message.find(filter)
    .sort({ created_at: -1 })
    .populate("attatchments", "-base64")
    .limit(fetch_limit)

  let next = null;
  let messagesToSend = messages;

  if (messages.length === fetch_limit) {
    next = messages[limit]?.id || null;
    messagesToSend = messages.slice(0, limit);
  }

  const data = { messages: messagesToSend.reverse(), next }
  return { message: "User messages retrieved successfully", data }
}

export async function transcribeAudio(payload: ITranscribeAudio) {
  const file = await File.findById(payload.file_id)
  if (!file) {
    throw new NotFoundException("File not found")
  }
  if (!file.type.startsWith("audio")) {
    throw new NotFoundException("Invalid file type ")
  }

  if (!isEmpty(file.transcription)) {
    return { message: "Transcription successful", data: file.transcription }
  }

  const prompt = createTranscriptionPrompt()
  const processedFile = await processFile(file)

  let contents = createUserContent([prompt, processedFile])

  const response = await gemini.models.generateContent({ model: GEMINI_MODEL, contents });
  const transcriptionData: ITranscriptionData = extractJson(response.text);

  if (!transcriptionData.full_text || !Array.isArray(transcriptionData.segments)) {
    await file.updateOne({ transcription: { full_text: response.text } })

    return { message: "Transcription successful", data: response.text }
  }

  await file.updateOne({ transcription: transcriptionData })
  return { message: "Transcription successful", data: transcriptionData }
}

export async function startConversation(payload: IStartMemory, user_id: string) {
  let prompt = null
  const user = await User.findById(user_id)

  if (!isEmpty(payload.prompt_id)) {
    prompt = await Prompt.findById(payload.prompt_id)
  }

  const systemInstruction = await createSystemContextWithPrompt(user, prompt);
  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction
    }
  });

  let content: PartListUnion = [payload.text]

  if (!isEmpty(payload?.attachments)) {
    const result = await processFiles(payload.attachments)
    content = [...content, ...result]
  }

  const memory = await Memory.create({
    title: prompt?.title || null,
    user: user_id,
    type: "conversation",
    status: "save",
    prompt: prompt?._id || null,
    message_count: 2,
    last_active: dayjs().toDate()
  })

  const userMessage = {
    user: user_id,
    memory: memory?.id,
    role: 'user',
    attatchments: payload?.attachments || [],
    text: payload?.text,
    created_at: dayjs().toDate()
  }

  const response = await chat.sendMessage({ message: content });

  const aiMessage = {
    user: user_id,
    memory: memory?.id,
    role: 'ai',
    text: response.text,
    created_at: dayjs().add(1, "second").toDate()
  }

  await Message.insertMany([userMessage, aiMessage])
  if (isEmpty(memory?.title)) {
    updateMemoryTitle(memory.id, payload.text, response.text)
  }

  // Queue insights extraction for significant first messages
  if (isSignificantMessage(payload.text)) {
    addToInsightsBuffer(user_id, memory.id, payload.text, response.text).catch(error => {
      console.error('Error queueing insights extraction:', error);
    });
  }

  updateStreak(user_id)

  return {
    data: { response: response.text, memory_id: memory?.id },
    message: "Conversation initialized successfully"
  }
}

export async function createEphemeralToken() {
  const expireTime = dayjs().add(30, "minute").toDate(); // 30 minutes from now
  const newSessionExpireTime = dayjs().add(2, "minutes").toDate(); // 2 minute from now

  const token = await geminiAuthClient.authTokens.create({
    config: {
      uses: 1,
      expireTime: expireTime.toISOString(),
      newSessionExpireTime: newSessionExpireTime.toISOString(),
      liveConnectConstraints: {
        model: GEMINI_LIVE_MODEL,
        config: {
          sessionResumption: {},
          responseModalities: [Modality.AUDIO]
        }
      },
      httpOptions: {
        apiVersion: 'v1alpha'
      }
    }
  });

  return {
    message: "Ephemeral token created successfully",
    data: {
      token: token.name,
      expiresAt: expireTime.toISOString()
    }
  };
}