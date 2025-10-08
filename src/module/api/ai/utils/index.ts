import path from "path";
import fs from "fs/promises";
import { createPartFromUri, createUserContent } from "@google/genai";
import { IMessage } from "../../../database/model/message";
import gemini, { GEMINI_MODEL } from "../../../../services/gemini";
import { ConversationContext } from "../interface";
import File, { IFile } from "../../../database/model/file"
import { TEMP_PATH } from "../../../../utils/config";
import { IUser } from "../../../database/model/user";
import dayjs from "dayjs";
import { createTitlePrompt } from "./prompts";
import Memory from "../../../database/model/memory";
import { getFileFromS3 } from "../../../media";
import { Readable } from "stream";

const SIZE_THRESHOLD = 18 * 1024 * 1024

export async function processFiles(file_ids: string[]) {
  const files = await File.find({ _id: { $in: file_ids } })
  const processed = await Promise.all(files.map(processFile))
  return processed.filter(Boolean);
}

export async function processFile(file: IFile) {
  let file_path = null
  try {
    // Fetch file from S3
    const s3Response = await getFileFromS3(file.name);

    if (!s3Response.Body) {
      throw new Error("File content not found in S3");
    }

    // Convert S3 stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = s3Response.Body as Readable;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const base64Data = buffer.toString('base64');

    if (Number(file.size) > SIZE_THRESHOLD) {
      file_path = path.join(TEMP_PATH, file.name)
      await fs.writeFile(file_path, buffer);

      const uploadedFile = await gemini.files.upload({
        file: file_path,
        config: { mimeType: file.type },
      });
      return createPartFromUri(uploadedFile.uri, uploadedFile.mimeType);
    } else {
      return {
        inlineData: {
          mimeType: file.type,
          data: base64Data,
        }
      }
    }
  } catch (error) {
    console.error('Error processing file:', error);
    return null
  } finally {
    if (file_path) fs.unlink(file_path);
  }
}

export function analyzeConversationContext(user: IUser, messages: IMessage[]): ConversationContext {
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

export function createChatHistory(messages: IMessage[]) {
  return messages.map(m => ({
    role: m.role === "ai" ? "model" : "user",
    parts: [{ text: m.text }]
  }));
}

export async function generateConversationTitle(userMessage: string, aiResponse: string): Promise<string> {
  const prompt = createTitlePrompt(userMessage, aiResponse);

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: createUserContent([prompt])
    });

    let title = response.text.trim();

    // Clean up the response to ensure it's just the title
    title = title.replace(/^["']|["']$/g, ''); // Remove quotes
    title = title.replace(/\n.*$/s, ''); // Remove everything after first line

    // Fallback if title is too short or generic
    if (title.length < 3 || title.toLowerCase().includes('conversation') || title.toLowerCase().includes('chat')) {
      title = `Conversation ${dayjs().format('MMM DD, YYYY')}`;
    }

    return title;
  } catch (error) {
    console.error('Error generating conversation title:', error);
    return `Conversation ${dayjs().format('MMM DD, YYYY')}`;
  }
}

export async function updateMemoryTitle(memoryId: string, userMessage: string, aiResponse: string): Promise<void> {
  try {
    const title = await generateConversationTitle(userMessage, aiResponse);
    await Memory.findByIdAndUpdate(memoryId, { title });
  } catch (error) {
    console.error('Error updating memory title:', error);
  }
}