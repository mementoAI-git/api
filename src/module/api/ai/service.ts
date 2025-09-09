import { Response } from "express";
import path from "path";
import fs from "fs/promises";
import { FilterQuery } from "mongoose";
import { createPartFromUri, createUserContent, GenerateContentResponse, PartListUnion } from "@google/genai";
import Message, { IMessage } from "../../database/model/message";
import gemini, { GEMINI_MODEL } from "../../../services/gemini";
import { extractJson, isEmpty } from "../../../utils/helpers";
import { IPagination } from "../../../utils/interface";
import { ConversationContext, IConversationAnalysis, IPrompt, ITranscribeAudio, IUserInsights } from "./interface";
import File, { IFile, ITranscriptionData } from "../../database/model/file"
import { NotFoundException } from "../../../utils/service-error";
import { TEMP_PATH } from "../../../utils/config";
import User, { IUser } from "../../database/model/user";
import dayjs from "dayjs";
import { createSystemContext, generateGreetingPrompt } from "./prompts";
import { createTranscriptionPrompt } from './prompts';
import { extractAllUserInsights } from './user-learning';
import Memory from "../../database/model/memory";

const SIZE_THRESHOLD = 18 * 1024 * 1024

export async function prompt(payload: IPrompt & { memory: string }, user_id: string) {
  const user = await User.findById(user_id)

  let messages = await Message.find({
    user: user_id,
    memory: payload.memory
  })
    .sort({ created_at: -1 })
    .limit(25)

  messages = messages.reverse()

  let content: PartListUnion = [payload.text]

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: createSystemContext(user)
    },
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
      })

      // Extract insights from this conversation asynchronously
      if (userMessage) {
        extractAllUserInsights(user, userMessage, text).catch(error => {
          console.error('Error extracting user insights:', error);
        });
      }
    }
    res.end();
  }
}

export async function greet(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException("User not found");
  }

  const messages = await Message.find({ user })
    .sort({ created_at: -1 })
    .limit(25);
  const reversedMessages = messages.reverse();

  const context = analyzeConversationContext(user, reversedMessages);
  const prompt = generateGreetingPrompt(context);

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: createSystemContext(user)
    },
    history: createChatHistory(reversedMessages)
  });

  return await chat.sendMessageStream({ message: prompt });
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

export async function startConversation(payload, user_id: string) {
  const user = await User.findById(user_id)

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: createSystemContext(user)
    }
  });

  let content: PartListUnion = [payload.text]

  if (!isEmpty(payload?.attachments)) {
    const result = await processFiles(payload.attachments)
    content = [...content, ...result]
  }

  const memory = await Memory.create({ user: user_id, status: "save" })
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

  return {
    data: { response: response.text, memory_id: memory?.id },
    message: "Conversation initialized successfully"
  }
}

async function processFiles(file_ids: string[]) {
  const files = await File.find({ _id: { $in: file_ids } })
  const processed = await Promise.all(files.map(processFile))
  return processed.filter(Boolean);
}

async function processFile(file: IFile) {
  let file_path = null
  try {
    if (Number(file.size) > SIZE_THRESHOLD) {
      file_path = path.join(TEMP_PATH, file.name)
      await fs.writeFile(file_path, Buffer.from(file.base64, 'base64'));

      const uploadedFile = await gemini.files.upload({
        file: file_path,
        config: { mimeType: file.type },
      });
      return createPartFromUri(uploadedFile.uri, uploadedFile.mimeType);
    } else {
      return {
        inlineData: {
          mimeType: file.type,
          data: file.base64,
        }
      }
    }
  } catch (error) {
    return null
  } finally {
    if (file_path) fs.unlink(file_path);
  }
}

function analyzeConversationContext(user: IUser, messages: IMessage[]): ConversationContext {
  const lastMessage = messages[messages.length - 1] || null;
  const lastUserMessage = messages.findLast(m => m.role === "user") || null;
  const lastAiMessage = messages.findLast(m => m.role === "ai") || null;
  const timeSinceLastMessage = lastMessage
    ? dayjs().diff(lastMessage.created_at, 'millisecond')
    : 0;

  return {
    user,
    messages,
    lastMessage,
    lastUserMessage,
    lastAiMessage,
    timeSinceLastMessage,
  };
}

function createChatHistory(messages: IMessage[]) {
  return messages.map(m => ({
    role: m.role === "ai" ? "model" : "user",
    parts: [{ text: m.text }]
  }));
}