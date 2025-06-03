import { createPartFromUri, createUserContent, GenerateContentResponse, PartListUnion } from "@google/genai";
import Message, { IMessage } from "../../model/message";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { Response } from "express";
import { isEmpty } from "../../utils/helpers";
import { IPagination } from "../../utils/interface";
import { IPrompt, ITranscribeAudio } from "./interface";
import File, { IFile } from "../../model/file"
import { NotFoundException } from "../../utils/service-error";
import { TEMP_PATH } from "../../utils/config";
import path from "path";
import fs from "fs/promises"
import { FilterQuery } from "mongoose";

const SIZE_THRESHOLD = 18 * 1024 * 1024

export async function prompt(payload: IPrompt, user: string) {
  let messages = await Message.find({ user }).sort({ created_at: -1 }).limit(25)
  messages = messages.reverse()

  let content: PartListUnion = [payload.text]

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
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
    next = messages[limit]?._id || null;
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

  const prompt = "Generate a transcript of the speech."
  const processedFile = await processFile(file)

  let contents = createUserContent([prompt, processedFile])

  const response = await gemini.models.generateContent({ model: GEMINI_MODEL, contents });
  await file.updateOne({ transcription: response.text })

  return { message: "Transcription successful", data: response.text }
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