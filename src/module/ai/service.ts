import { ContentListUnion, createPartFromUri, createUserContent, GenerateContentResponse } from "@google/genai";
import Message from "../../model/message";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { Response } from "express";
import { isEmpty } from "../../utils/helpers";
import { IPagination } from "../../utils/interface";
import { IPrompt, ITranscribeAudio } from "./interface";
import File from "../../model/file"
import { NotFoundException } from "../../utils/service-error";
import { TEMP_PATH } from "../../utils/config";
import path from "path";
import fs from "fs/promises"

const SIZE_THRESHOLD = 18 * 1024 * 1024

export async function prompt(payload: IPrompt, user: string) {
  const messages = await Message.find({ user }).limit(25)

  const chat = gemini.chats.create({
    model: GEMINI_MODEL,
    history: messages.map(m => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }]
    }))
  });

  const response = await chat.sendMessageStream({ message: payload?.text });
  await Message.create({ user, role: 'user', text: payload?.text })

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
    res.end();
    if (!isEmpty(text)) {
      await Message.create({ text, user, role: "ai" })
    }
  }
}

export async function getUserMessages({ page, limit }: IPagination, user: string) {
  const data = await Message.paginate(
    { user },
    { page, limit }
  )

  return { message: "User messages retrieved successfully", data }
}

export async function transcribeAudio(payload: ITranscribeAudio) {
  let file_path = null
  const file = await File.findById(payload.file_id)
  if (!file) {
    throw new NotFoundException("File not found")
  }
  if (!file.type.startsWith("audio")) {
    throw new NotFoundException("Invalid file type ")
  }

  const prompt = "Generate a transcript of the speech."
  let contents: ContentListUnion = []

  if (Number(file.size) > SIZE_THRESHOLD) {
    file_path = path.join(TEMP_PATH, file.name)
    await fs.writeFile(file_path, Buffer.from(file.base64, 'base64'));

    const uploadedFile = await gemini.files.upload({
      file: file_path,
      config: { mimeType: file.type },
    });

    contents = createUserContent([
      createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
      prompt,
    ])
  } else {
    contents = [
      { text: prompt },
      {
        inlineData: {
          mimeType: file.type,
          data: file.base64,
        },
      },
    ]
  }

  const response = await gemini.models.generateContent({ model: GEMINI_MODEL, contents });

  if (file_path) fs.unlink(file_path);
  return { message: "Transcription successful", data: response.text }
}