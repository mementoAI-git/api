import path from "path";
import fs from "fs/promises";
import { createPartFromUri, createUserContent } from "@google/genai";
import { IMessage } from "../../../database/model/message";
import gemini, { GEMINI_MODEL } from "../../../../services/gemini";
import File, { IFile } from "../../../database/model/file"
import { TEMP_PATH } from "../../../../utils/config";
import dayjs from "dayjs";
import { extractJson, prompts } from "../../../../utils";
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
  const comprehensivePrompt = `Analyze this conversation exchange and extract comprehensive user insights. Return ONLY a valid JSON object:

Return ONLY a valid JSON object with NEW insights:

{
  "important_notes": ["Only NEW important notes not already covered"],
  "key_preferences": ["Only NEW preferences not already listed"],
  "emotional_state_trends": ["Only NEW emotional patterns"],
  "goals_and_aspirations": ["Only NEW goals not already mentioned"]
}

EXISTING CONTEXT:
Important Notes: ${existingContext?.important_notes?.join(', ') || 'None'}
Key Preferences: ${existingContext?.key_preferences?.join(', ') || 'None'}
Emotional Trends: ${existingContext?.emotional_state_trends?.join(', ') || 'None'}
Goals: ${existingContext?.goals_and_aspirations?.join(', ') || 'None'}

EXTRACTION GUIDELINES:
- important_notes: Focus on personality traits, life experiences, values, beliefs, relationships, goals, fears, achievements, or significant events
- key_preferences: Focus on likes, dislikes, hobbies, interests, work preferences, lifestyle choices, food preferences, entertainment choices, etc.
- emotional_state_trends: Focus on emotional patterns, mood indicators, stress levels, energy levels, emotional triggers
- goals_and_aspirations: Focus on future-oriented statements, dreams, plans, career goals, personal milestones

EXTRACTION RULES:
- Be specific and actionable - avoid generic statements
- Extract only meaningful insights that would help personalize future interactions
- If no meaningful insights are found for a category, return an empty array
- Focus on information that would help create a more personalized experience
- Combine related insights rather than creating multiple similar entries

Focus on information that would help create a more personalized and understanding relationship.`;

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

    // Add all types of insights using $addToSet to avoid duplicates
    let isModifyingArrays = false;

    if (insights.important_notes && insights.important_notes.length > 0) {
      updateData['$addToSet'] = {
        'important_notes': { $each: insights.important_notes }
      };
      isModifyingArrays = true;
    }

    if (insights.key_preferences && insights.key_preferences.length > 0) {
      if (!updateData['$addToSet']) updateData['$addToSet'] = {};
      updateData['$addToSet']['key_preferences'] = { $each: insights.key_preferences };
      isModifyingArrays = true;
    }

    if (insights.emotional_state_trends && insights.emotional_state_trends.length > 0) {
      if (!updateData['$addToSet']) updateData['$addToSet'] = {};
      updateData['$addToSet']['emotional_state_trends'] = { $each: insights.emotional_state_trends };
    }

    if (insights.goals_and_aspirations && insights.goals_and_aspirations.length > 0) {
      if (!updateData['$addToSet']) updateData['$addToSet'] = {};
      updateData['$addToSet']['goals_and_aspirations'] = { $each: insights.goals_and_aspirations };
    }

    if (Object.keys(updateData).length > 0) {
      // Set last_array_update when important_notes or key_preferences are modified
      if (isModifyingArrays) {
        if (!updateData['$set']) updateData['$set'] = {};
        updateData['$set'].last_array_update = new Date();
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