import path from "path";
import fs from "fs/promises";
import { createPartFromUri, createUserContent } from "@google/genai";
import { IMessage } from "../../../database/model/message";
import gemini, { GEMINI_MODEL } from "../../../../services/gemini";
import File, { IFile } from "../../../database/model/file"
import { TEMP_PATH } from "../../../../utils/config";
import dayjs from "dayjs";
import { extractJson, logger, prompts, PERSONA_INSIGHT_FIELDS } from "../../../../utils";
import Memory from "../../../database/model/memory";
import { getFileFromS3 } from "../../../media";
import { Readable } from "stream";
import { queueSummarization } from "../../../../services/queues";
import Persona, { IPersona } from "../../../database/model/persona";

const SIZE_THRESHOLD = 18 * 1024 * 1024
const INACTIVITY_MINUTES = 10; // Summarize after 10 minutes of inactivity
const MIN_MESSAGES_FOR_SUMMARY = 10; // At least 5 exchange (user + AI)

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

export function createChatHistory(messages: IMessage[]) {
  return messages.map(m => ({
    role: m.role === "ai" ? "model" : "user",
    parts: [{ text: m.text }]
  }));
}

export async function generateConversationTitle(userMessage: string, aiResponse: string): Promise<string> {
  const prompt = prompts.createTitlePrompt(userMessage, aiResponse);

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

/**
 * Check if a message is significant enough to extract insights from.
 * Filters out trivial messages like "ok", "thanks", etc.
 */
export function isSignificantMessage(message: string): boolean {
  if (!message || message.length < 20) return false;

  const trivialPatterns = /^(ok|okay|sure|thanks|thank you|got it|cool|nice|great|yes|no|yep|nope|alright|fine|good|right|hmm|hm|ah|oh|wow|lol|haha|k|yea|yeah|nah)\.?!?$/i;
  return !trivialPatterns.test(message.trim());
}

export function shouldSummarize(memory: any): boolean {
  if (!memory) return false;

  const messageCount = memory.message_count || 0;
  if (messageCount < MIN_MESSAGES_FOR_SUMMARY) return false; // Not enough messages

  const lastActive = memory.last_active || memory.updated_at;
  if (!lastActive) return false;

  const minutesSinceActive = dayjs().diff(dayjs(lastActive), 'minute');
  return minutesSinceActive >= INACTIVITY_MINUTES;
}

export async function triggerSummarization(memoryId: string): Promise<boolean> {
  try {
    const memory = await Memory.findById(memoryId);
    if (!memory || memory.type !== 'conversation') {
      return false;
    }

    if (shouldSummarize(memory)) {
      await queueSummarization(memoryId);
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

export async function getRecentConversationSummaries(
  userId: string,
  excludeMemoryId?: string,
  limit: number = 5
): Promise<Array<{ title: string; summary: string; topics: string[] }>> {
  try {
    const query: any = {
      user: userId,
      type: 'conversation',
      summary: { $exists: true, $ne: null }
    };

    if (excludeMemoryId) {
      query._id = { $ne: excludeMemoryId };
    }

    const memories = await Memory.find(query)
      .sort({ updated_at: -1 })
      .limit(limit)
      .select('title summary topics');

    return memories.map(m => ({
      title: m.title || 'Untitled conversation',
      summary: m.summary || '',
      topics: m.topics || []
    }));
  } catch (error) {
    console.error('Error fetching conversation summaries:', error);
    return [];
  }
}

export async function extractAllUserInsights(user_id: string, userMessage: string, aiResponse: string): Promise<void> {
  const persona = await Persona.findOne({ user: user_id });
  const existingContext = persona || {} as IPersona;

  const comprehensivePrompt = prompts.buildInsightsPrompt(existingContext);

  try {
    const conversationText = `User: ${userMessage}\n\nAI: ${aiResponse}`;

    const contents = createUserContent([
      comprehensivePrompt,
      { text: conversationText }
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const insights = extractJson(response.text);
    // Prepare update data
    const updateData: any = {};
    const now = new Date();

    const fieldsUpdated: string[] = [];

    PERSONA_INSIGHT_FIELDS.forEach(field => {
      if (insights?.[field] && insights?.[field].length > 0) {
        updateData['$addToSet'] = {
          [field]: { $each: insights[field] }
        };
        fieldsUpdated.push(field);
      }
    })

    if (Object.keys(updateData).length > 0) {
      if (!updateData['$set']) updateData['$set'] = {};

      // Set per-field update timestamps
      if (fieldsUpdated.length > 0) {
        updateData['$set'].last_array_update = now;

        fieldsUpdated.forEach(field => {
          updateData['$set'][`last_update.${field}`] = now;
        });
      }

      await Persona.findOneAndUpdate(
        { user: user_id },
        updateData,
        { upsert: true, new: true }
      );
    }

  } catch (error) {
    console.error('Error extracting user insights:', error);
  }
}