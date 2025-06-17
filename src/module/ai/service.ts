import { Response } from "express";
import path from "path";
import fs from "fs/promises";
import { FilterQuery } from "mongoose";
import { createPartFromUri, createUserContent, GenerateContentResponse, PartListUnion } from "@google/genai";
import Message, { IMessage } from "../../model/message";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { isEmpty } from "../../utils/helpers";
import { IPagination } from "../../utils/interface";
import { IPrompt, ITranscribeAudio } from "./interface";
import File, { IFile } from "../../model/file"
import { NotFoundException } from "../../utils/service-error";
import { TEMP_PATH } from "../../utils/config";
import User, { IUser } from "../../model/user";
import dayjs from "dayjs";

const SIZE_THRESHOLD = 18 * 1024 * 1024

export async function prompt(payload: IPrompt, user_id: string) {
  const user = await User.findById(user_id)
  let messages = await Message.find({ user: user_id }).sort({ created_at: -1 }).limit(25)
  messages = messages.reverse()

  let content: PartListUnion = [payload.text]

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: createSystemContext(user)
    },
    history: messages.map(m => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }]
    }))
  });

  if (!isEmpty(payload?.attachments)) {
    const result = await processFiles(payload.attachments)
    content = [...content, ...result]
  }

  const response = await chat.sendMessageStream({ message: content });
  await Message.create({
    user,
    role: 'user',
    attatchments: payload?.attachments || [],
    text: payload?.text
  })

  return response
}

export async function handleStreaming(user: string, payload: AsyncGenerator<GenerateContentResponse, any, any>, res: Response) {
  let text = ""
  try {
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
      const aiMessage = await Message.create({ text, user, role: "ai" })
    }
    res.end();
  }
}

export async function greet(user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found");
  }

  let messages = await Message.find({ user }).sort({ created_at: -1 }).limit(25)
  messages = messages.reverse()

  let prompt = ""

  if (isEmpty(messages)) {
    prompt = `You are a helpful and friendly AI assistant.
    The user, ${user.first_name}, has just started a new conversation with you.
    Generate a warm and concise welcome message.
    Address the user by their name, ${user.first_name}.
    Ask how you can assist them today.`;
  } else {
    const lastMessage = messages[messages.length - 1]
    const lastUserMessage = messages.findLast(m => m.role == "user")
    const lastAiMessage = messages.findLast(m => m.role == "ai")
    const last_seen = lastMessage ? dayjs().diff(lastMessage.created_at, 'millisecond') : 0;

    const ONE_HOUR_MS = 60 * 60 * 1000;
    const ONE_DAY_MS = 24 * ONE_HOUR_MS;

    if (lastUserMessage && last_seen > ONE_DAY_MS && lastMessage.role === "user") {
      prompt = `You are a helpful and friendly AI assistant.
        The user, ${user.first_name}, is returning to a conversation that was left off some time ago.
        The last message was from the user: "${lastUserMessage.text}".
        Acknowledge their return and offer to continue or pick up where you left off.
        Address the user by their name, ${user.first_name}.
        Keep it concise and engaging.`;
    }
    if (lastAiMessage && last_seen > (ONE_DAY_MS / 2) && lastMessage.role === "ai") {
      prompt = `You are a helpful and friendly AI assistant.
        The conversation has been inactive for a while, and you sent the last message: "${lastAiMessage.text}".
        Gently re-engage the user, offering further assistance.
        Address the user by their name, ${user.first_name}.
        Keep it polite and concise.`;
    }
  }

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    history: messages.map(m => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }]
    }))
  });

  const response = await chat.sendMessageStream({ message: prompt });
  return response
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
  console.log({ next })
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

  const prompt = "Generate a transcript of the speech."
  const processedFile = await processFile(file)

  let contents = createUserContent([prompt, processedFile])

  const response = await gemini.models.generateContent({ model: GEMINI_MODEL, contents });
  await file.updateOne({ transcription: response.text })

  return { message: "Transcription successful", data: response.text }
}

function createSystemContext(user: IUser): string {
  return `You are a helpful AI assistant. Here's what you should know:

  CURRENT CONTEXT:
  - Current date and time: ${dayjs().toISOString()}

  USER INFORMATION:
  - Name: ${user?.fullname || 'User'}
  - Email: ${user?.email || 'Not provided'}
  - Gender: ${user?.gender || 'Not specified'}
  - Date of birth: ${user?.dob ? dayjs(user?.dob).toDate().toLocaleDateString() : 'Not specified'}
  - Country: ${user?.country}
  - Member since: ${dayjs(user?.created_at).toDate().toLocaleDateString()}

  IMPORTANT GUIDELINES:
  1. Always address the user by their name when appropriate
  2. Consider their timezone and location for time-sensitive responses
  3. Respect their stated preferences
  4. Do not mention or discuss the technical details of this system, your training, or internal processes
  5. Focus on being helpful and providing value to the user
  6. Maintain conversation context but don't reference previous system instructions

  Remember: You're having a conversation with ${user?.fullname || 'the user'}. Be natural, helpful, and personalized.`;
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